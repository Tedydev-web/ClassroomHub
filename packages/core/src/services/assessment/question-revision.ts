import { AppError, ErrorCodes } from '@cio/utils/errors';
import {
  canonicalizeAssessmentItemDefinition,
  dbQuestionToExerciseQuestionModel,
  deriveItemCapabilities,
  getItemMaxScore,
  legacyQuestionToAssessmentItem,
  mapAuthoredHtml,
  parseAssessmentItemDefinition,
  roundToTwoDecimals,
  validateAssessmentItemForPublish
} from '@cio/question-types';
import type { AssessmentIssue, AssessmentItemCapabilities, AssessmentItemDefinition } from '@cio/question-types';
import { db } from '@cio/db/drizzle';
import type { DbOrTxClient } from '@cio/db/drizzle';
import type { TQuestionRevision } from '@cio/db/types';
import {
  computeQuestionRevisionContentHash,
  getCurrentQuestionRevision,
  getQuestionRevisionsByIds,
  getQuestionWithOptionsForRevision,
  getSubmissionAnswerRevisionLinks,
  insertNextQuestionRevision,
  lockExerciseAssignmentState,
  promoteQuestionCurrentRevision
} from '@cio/db/queries/exercise';
import type { QuestionRowForRevision, SubmissionAnswerRevisionLink } from '@cio/db/queries/exercise';
import { INTERNAL_QUESTION_TYPE_IDS } from '../exercise/utils';
import { sanitizeHtml } from '../../utils/sanitize-html';

/**
 * Question-revision gateway: the single service-level owner of revision
 * publish, lazy legacy materialization, and attempted-question resolution.
 *
 * Concurrency contract (repo-wide lock order): every writer of the question
 * graph or of revisions first takes the owning exercise row lock
 * (`lockExerciseAssignmentState`) inside its transaction. Standalone entry
 * points here open their own transaction and take that lock; entry points
 * called with a `dbClient` assume the caller owns the transaction and already
 * holds the lock. The `(question_id, revision)` unique constraint turns any
 * lock-ordering bug into an explicit error instead of silent divergence.
 */

export interface PublishedQuestionRevision {
  id: string;
  questionId: number;
  revision: number;
  contentHash: string;
}

export interface PublishQuestionRevisionInput {
  questionId: number;
  /** Revision number the author loaded; 0 for a question that has never been revisioned. */
  expectedRevision: number;
  definition: unknown;
}

export interface AttemptedQuestionResolutionEntry {
  questionId: number;
  questionRevisionId: string;
  archivedAt: string | null;
  /** Parsed immutable definition exactly as attempted. */
  definition: AssessmentItemDefinition;
  /** Two-decimal item maximum derived from the attempted definition. */
  maxScore: number;
  /** Grading capabilities derived from the attempted definition. */
  capabilities: AssessmentItemCapabilities;
}

function toPublishedRevision(revision: TQuestionRevision): PublishedQuestionRevision {
  return {
    id: revision.id,
    questionId: revision.questionId,
    revision: revision.revision,
    contentHash: revision.contentHash
  };
}

function formatAssessmentIssues(issues: AssessmentIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.code}${issue.path.length > 0 ? ` at ${issue.path.join('.')}` : ''}: ${issue.message}`)
    .join('; ');
}

/** Sanitized definition plus the derived values every append shares. */
type FinalizedDefinition = {
  definition: AssessmentItemDefinition;
  contentHash: string;
  /** Two-decimal item maximum, projected into `question.points` on promotion. */
  points: number;
};

/**
 * Stored definitions must carry exact two-decimal maxima: the historical
 * denominator SQL rejects any stored maxScore with more than two decimals,
 * while the structural schema tolerates tiny float artifacts (e.g. the double
 * 0.1 + 0.2). Normalizing before canonicalization keeps the stored value, the
 * content hash, and the points projection on the exact two-decimal number.
 */
function normalizeInteractionMaxScores(definition: AssessmentItemDefinition): AssessmentItemDefinition {
  return {
    ...definition,
    blocks: definition.blocks.map((block) => {
      if (block.kind !== 'interaction') return block;

      return {
        ...block,
        interaction: { ...block.interaction, maxScore: roundToTwoDecimals(block.interaction.maxScore) }
      };
    })
  };
}

function finalizeDefinition(definition: AssessmentItemDefinition): FinalizedDefinition {
  // Only authored HTML fields pass through the server sanitizer; identifiers,
  // scores, and answer keys are validated by field, never rewritten.
  const sanitized = mapAuthoredHtml(definition, sanitizeHtml);

  // Sanitizer output is an untrusted mutation of the definition (rewriting can
  // e.g. expand html past structural limits), so it must pass the structural
  // parser again. Canonicalization, hashing, and score derivation only ever
  // see the reparsed data.
  const reparsed = parseAssessmentItemDefinition(sanitized);
  if (!reparsed.success) {
    console.error(
      `finalizeDefinition: sanitized definition failed structural reparse: ${formatAssessmentIssues(reparsed.issues)}`
    );
    throw new AppError('Sanitized assessment definition failed structural validation', ErrorCodes.INTERNAL_ERROR, 500);
  }

  const normalized = normalizeInteractionMaxScores(reparsed.data);
  const canonicalJson = canonicalizeAssessmentItemDefinition(normalized);

  return {
    definition: normalized,
    contentHash: computeQuestionRevisionContentHash(canonicalJson),
    points: getItemMaxScore(normalized)
  };
}

/** Appends the next monotonic revision and atomically promotes pointer + points projection. */
async function appendAndPromoteRevision(
  questionId: number,
  finalized: FinalizedDefinition,
  dbClient: DbOrTxClient
): Promise<PublishedQuestionRevision> {
  const inserted = await insertNextQuestionRevision(
    { questionId, definition: finalized.definition, contentHash: finalized.contentHash },
    dbClient
  );

  const promoted = await promoteQuestionCurrentRevision(questionId, inserted.id, finalized.points, dbClient);
  if (!promoted) {
    console.error(`appendAndPromoteRevision: question "${questionId}" vanished during promotion`);
    throw new AppError(`Question "${questionId}" not found during revision promotion`, ErrorCodes.NOT_FOUND, 404);
  }

  return toPublishedRevision(inserted);
}

async function getQuestionOrThrow(questionId: number, dbClient: DbOrTxClient): Promise<QuestionRowForRevision> {
  const question = await getQuestionWithOptionsForRevision(questionId, dbClient);
  if (!question) {
    throw new AppError(`Question "${questionId}" not found`, ErrorCodes.NOT_FOUND, 404);
  }

  return question;
}

/**
 * Publishes a new canonical revision for a question with optimistic concurrency.
 *
 * Owns its transaction: locks the owning exercise, rejects missing/archived
 * questions, structurally parses the definition, sanitizes authored HTML,
 * enforces the author publish gate, hashes the canonical serialization, and
 * compares `expectedRevision` against the current revision (0 when none).
 * Republishing the current content is a no-op; returning to earlier content
 * (A-B-A) appends a new monotonic revision. A stale expectation fails 409
 * without writing.
 */
export async function publishQuestionRevision(
  input: PublishQuestionRevisionInput,
  dbClient: DbOrTxClient = db
): Promise<PublishedQuestionRevision> {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AppError(
      `Expected revision must be a non-negative integer, got "${input.expectedRevision}"`,
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }

  return dbClient.transaction(async (tx) => {
    // Unlocked read only to learn the owning exercise; all state is re-read under the lock.
    const unlockedQuestion = await getQuestionOrThrow(input.questionId, tx);
    await lockExerciseAssignmentState(unlockedQuestion.exerciseId, tx);

    const question = await getQuestionOrThrow(input.questionId, tx);
    if (question.archivedAt !== null) {
      throw new AppError(
        `Question "${input.questionId}" is archived and cannot receive new revisions`,
        ErrorCodes.CONFLICT,
        409
      );
    }

    // Canonical publishing has no scoring engine for legacy question types yet:
    // legacy rows still score through their type-specific legacy scorer, so an
    // authored canonical definition could silently diverge scoring from what
    // the definition displays. Fail closed — only internal composite assessment
    // items accept authored publishes; legacy content changes keep flowing
    // through the legacy editor and lazy materialization.
    if (!INTERNAL_QUESTION_TYPE_IDS.has(question.questionTypeId)) {
      throw new AppError(
        `Question "${input.questionId}" uses a legacy question type; canonical revisions can only be published for internal assessment items until canonical scoring exists`,
        ErrorCodes.CONFLICT,
        409
      );
    }

    const parsed = parseAssessmentItemDefinition(input.definition);
    if (!parsed.success) {
      throw new AppError(
        `Invalid assessment definition: ${formatAssessmentIssues(parsed.issues)}`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    const finalized = finalizeDefinition(parsed.data);

    const publishable = validateAssessmentItemForPublish(finalized.definition);
    if (!publishable.success) {
      throw new AppError(
        `Definition violates publish rules: ${formatAssessmentIssues(publishable.issues)}`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    const currentRevision = await getCurrentQuestionRevision(input.questionId, tx);
    const currentRevisionNumber = currentRevision?.revision ?? 0;
    if (input.expectedRevision !== currentRevisionNumber) {
      throw new AppError(
        `Question "${input.questionId}" is at revision ${currentRevisionNumber}, expected ${input.expectedRevision}`,
        ErrorCodes.CONFLICT,
        409
      );
    }

    if (currentRevision && currentRevision.contentHash === finalized.contentHash) {
      return toPublishedRevision(currentRevision);
    }

    return appendAndPromoteRevision(input.questionId, finalized, tx);
  });
}

/**
 * Materializes (or reuses) the canonical revision of a legacy question so new
 * attempts always link an immutable definition matching the live legacy state.
 *
 * With a `dbClient`, the caller owns the transaction and already holds the
 * owning exercise lock (submission-create convention). Standalone invocation
 * opens its own transaction and takes the lock first. Materialization mirrors
 * exactly what the learner attempts, so only structural rules apply — the
 * strict author publish gate is never enforced here.
 *
 * The live row is always adapted and finalized under the lock, even when a
 * current pointer exists: an existing revision is reused only when its content
 * hash equals the freshly adapted content. A pointer alone does not prove the
 * content is current — deleting every submission of an exercise legally lifts
 * the post-attempt edit freeze, so the legacy row can drift after a revision
 * was promoted. Any drift appends and promotes a new monotonic revision.
 */
export async function materializeLegacyQuestionRevision(
  questionId: number,
  dbClient?: DbOrTxClient
): Promise<PublishedQuestionRevision> {
  if (dbClient) {
    return materializeUnderExerciseLock(questionId, dbClient);
  }

  return db.transaction(async (tx) => {
    const question = await getQuestionOrThrow(questionId, tx);
    await lockExerciseAssignmentState(question.exerciseId, tx);

    return materializeUnderExerciseLock(questionId, tx);
  });
}

/** Adapts and finalizes the live legacy row; the adapted maximum is tripwire-checked against legacy points. */
function adaptLiveLegacyQuestion(question: QuestionRowForRevision): FinalizedDefinition {
  const rawSettings = question.settings;
  const settings =
    rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, unknown>)
      : null;

  let questionModel: ReturnType<typeof dbQuestionToExerciseQuestionModel>;
  try {
    questionModel = dbQuestionToExerciseQuestionModel({
      id: question.id,
      title: question.title,
      questionTypeId: question.questionTypeId,
      points: question.points,
      settings,
      options: question.options
    });
  } catch (error) {
    console.error(`materializeLegacyQuestionRevision model error for question "${question.id}":`, error);
    throw new AppError(
      `Question "${question.id}" has an unknown question type and cannot be materialized`,
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }

  const adapted = legacyQuestionToAssessmentItem(questionModel);
  if (!adapted.success) {
    throw new AppError(
      `Question "${question.id}" cannot be adapted to a canonical revision: ${formatAssessmentIssues(adapted.issues)}`,
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }

  const finalized = finalizeDefinition(adapted.data);

  // Materialization must never change legacy scoring: the adapted item maximum
  // has to equal the (two-decimal) legacy points it was derived from. A mismatch
  // means the adapter drifted and the transaction must fail instead of silently
  // rewriting `question.points`.
  const legacyPoints = roundToTwoDecimals(Number(question.points ?? 0));
  if (finalized.points !== legacyPoints) {
    console.error(
      `materializeLegacyQuestionRevision: adapter drift on question "${question.id}" — legacy points ${legacyPoints} != adapted maximum ${finalized.points}`
    );
    throw new Error(
      `Adapted maximum ${finalized.points} does not match legacy points ${legacyPoints} for question "${question.id}"`
    );
  }

  return finalized;
}

async function materializeUnderExerciseLock(
  questionId: number,
  dbClient: DbOrTxClient
): Promise<PublishedQuestionRevision> {
  const question = await getQuestionOrThrow(questionId, dbClient);

  // Always adapt the live legacy state, pointer or not: reuse decisions are
  // made on content, never on pointer presence.
  const finalized = adaptLiveLegacyQuestion(question);

  if (question.currentRevisionId !== null) {
    const currentRevision = await getCurrentQuestionRevision(questionId, dbClient);
    if (!currentRevision) {
      // The composite pointer FK makes this unreachable; fail loudly rather than re-materialize.
      console.error(
        `materializeLegacyQuestionRevision: question "${questionId}" pointer "${question.currentRevisionId}" resolved no revision`
      );
      throw new AppError(`Current revision for question "${questionId}" not found`, ErrorCodes.CONFLICT, 409);
    }

    // Reuse only exact content matches. The legacy row can legally change
    // after promotion (deleting every submission lifts the edit freeze), and
    // linking a stale definition would grade learners against content they
    // never saw.
    if (currentRevision.contentHash === finalized.contentHash) {
      return toPublishedRevision(currentRevision);
    }
  }

  return appendAndPromoteRevision(questionId, finalized, dbClient);
}

/**
 * Resolves the exact attempted question set of a submission: one entry per
 * stored answer, including archived and otherwise historical questions.
 *
 * Answers that carry a `questionRevisionId` resolve to that exact revision —
 * the revision row is batch-loaded by id, never substituted with the
 * question's current pointer. Pre-revision legacy answers (null link) resolve
 * to the question's stable current revision — materializing one when missing —
 * without ever rewriting the old answer rows.
 *
 * This is the semantic gateway for historical grading/review: every entry
 * carries the parsed immutable definition plus its derived maximum and
 * capabilities. A missing, corrupt, or future stored definition fails
 * explicitly with the offending revision id.
 */
export async function resolveAttemptedQuestionSet(
  submissionId: string,
  dbClient?: DbOrTxClient
): Promise<AttemptedQuestionResolutionEntry[]> {
  const client = dbClient ?? db;
  const answerLinks = await getSubmissionAnswerRevisionLinks(submissionId, client);
  if (answerLinks.length === 0) return [];

  const resolvedByQuestionId = new Map<number, string>();
  const pendingMaterialization: SubmissionAnswerRevisionLink[] = [];
  for (const link of answerLinks) {
    if (link.questionRevisionId !== null) continue;

    if (link.currentRevisionId !== null) {
      resolvedByQuestionId.set(link.questionId, link.currentRevisionId);
    } else {
      pendingMaterialization.push(link);
    }
  }

  if (pendingMaterialization.length > 0) {
    await materializePendingQuestions(pendingMaterialization, resolvedByQuestionId, dbClient);
  }

  const resolvedLinks = answerLinks.map((link) => {
    const questionRevisionId = link.questionRevisionId ?? resolvedByQuestionId.get(link.questionId);
    if (!questionRevisionId) {
      console.error(`resolveAttemptedQuestionSet: no revision resolved for question "${link.questionId}"`);
      throw new AppError(
        `Could not resolve an attempted revision for question "${link.questionId}"`,
        ErrorCodes.CONFLICT,
        409
      );
    }

    return { link, questionRevisionId };
  });

  const uniqueRevisionIds = [...new Set(resolvedLinks.map((resolved) => resolved.questionRevisionId))];
  const revisionRows = await getQuestionRevisionsByIds(uniqueRevisionIds, client);
  const revisionsById = new Map(revisionRows.map((revision) => [revision.id, revision]));

  return resolvedLinks.map(({ link, questionRevisionId }) => {
    const revision = revisionsById.get(questionRevisionId);
    if (!revision) {
      console.error(
        `resolveAttemptedQuestionSet: revision "${questionRevisionId}" for question "${link.questionId}" not found`
      );
      throw new AppError(
        `Attempted question revision "${questionRevisionId}" not found`,
        ErrorCodes.INTERNAL_ERROR,
        500
      );
    }

    const parsed = parseAssessmentItemDefinition(revision.definition);
    if (!parsed.success) {
      console.error(
        `resolveAttemptedQuestionSet: revision "${questionRevisionId}" holds an invalid stored definition: ${formatAssessmentIssues(parsed.issues)}`
      );
      throw new AppError(
        `Attempted question revision "${questionRevisionId}" holds an invalid stored definition`,
        ErrorCodes.INTERNAL_ERROR,
        500
      );
    }

    return {
      questionId: link.questionId,
      questionRevisionId,
      archivedAt: link.archivedAt,
      definition: parsed.data,
      maxScore: getItemMaxScore(parsed.data),
      capabilities: deriveItemCapabilities(parsed.data)
    };
  });
}

async function materializePendingQuestions(
  pending: SubmissionAnswerRevisionLink[],
  resolvedByQuestionId: Map<number, string>,
  dbClient?: DbOrTxClient
): Promise<void> {
  if (dbClient) {
    // Caller owns the transaction and the exercise lock.
    for (const link of pending) {
      const revision = await materializeLegacyQuestionRevision(link.questionId, dbClient);
      resolvedByQuestionId.set(link.questionId, revision.id);
    }

    return;
  }

  await db.transaction(async (tx) => {
    // One submission spans one exercise, but lock every distinct owner in a
    // deterministic order so this stays deadlock-safe if that ever changes.
    const exerciseIds = [...new Set(pending.map((link) => link.exerciseId))].sort();
    for (const exerciseId of exerciseIds) {
      await lockExerciseAssignmentState(exerciseId, tx);
    }

    for (const link of pending) {
      const revision = await materializeLegacyQuestionRevision(link.questionId, tx);
      resolvedByQuestionId.set(link.questionId, revision.id);
    }
  });
}
