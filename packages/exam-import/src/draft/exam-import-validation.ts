import { normalizeComparableText } from '../source-run';
import { mapExamImportDraftHtml } from './exam-import-authored-html';
import {
  MAX_EXAM_IMPORT_DIAGNOSTICS,
  MAX_EXAM_IMPORT_TOTAL_QUESTIONS,
  examImportDiagnosticSchema,
  examImportDraftSchema,
  requiresExamImportAnswerKey,
  type ExamImportDiagnostic,
  type ExamImportDraft,
  type ExamImportFieldTarget,
  type ExamImportPublishableQuestionKind,
  type ExamImportQuestion
} from './exam-import-draft';

export type ExamImportSemanticValidationContext = {
  enabledQuestionKinds: ReadonlySet<ExamImportPublishableQuestionKind>;
};

export type ExamImportValidationContext = ExamImportSemanticValidationContext & {
  sanitizeHtml: (html: string) => string;
};

export type ExamImportValidationResult = {
  draft: ExamImportDraft | null;
  findings: ExamImportDiagnostic[];
  publishable: boolean;
};

export type ExamImportStructuralValidationResult = Omit<ExamImportValidationResult, 'publishable'>;

export type ExamImportAssistedValidationResult = {
  findings: ExamImportDiagnostic[];
  accepted: boolean;
};

type DraftIndex = {
  sharedContentIds: ReadonlySet<string>;
  sectionIds: ReadonlySet<string>;
  questionsById: ReadonlyMap<string, ExamImportQuestion>;
  optionIdsByQuestionId: ReadonlyMap<string, ReadonlySet<string>>;
  statementIdsByQuestionId: ReadonlyMap<string, ReadonlySet<string>>;
};

function diagnostic(
  code: string,
  message: string,
  question: ExamImportQuestion | null = null,
  target: ExamImportFieldTarget | null = null
): ExamImportDiagnostic {
  return {
    tier: 'semantic',
    severity: 'error',
    blocking: true,
    code,
    message,
    messageKey: `exam_import.diagnostics.${code.toLowerCase()}`,
    questionId: question?.id ?? null,
    target,
    provenance: question?.provenance ?? []
  };
}

function structuralDiagnostic(path: readonly PropertyKey[], message: string): ExamImportDiagnostic {
  const readablePath = path.length > 0 ? path.map(String).join('.') : 'draft';

  return {
    tier: 'structural',
    severity: 'error',
    blocking: true,
    code: 'STRUCTURAL_SCHEMA_INVALID',
    message: `${readablePath}: ${message}`,
    messageKey: 'exam_import.diagnostics.structural_schema_invalid',
    questionId: null,
    target: null,
    provenance: []
  };
}

function invalidAssistedFinding(): ExamImportDiagnostic {
  return {
    tier: 'assisted',
    severity: 'warning',
    blocking: false,
    code: 'ASSISTED_VALIDATION_INVALID',
    message: 'Assisted validation returned findings outside its advisory contract',
    messageKey: 'exam_import.diagnostics.assisted_validation_invalid',
    questionId: null,
    target: null,
    provenance: []
  };
}

export function validateExamImportAssistedFindings(value: unknown): ExamImportAssistedValidationResult {
  const parsed = examImportDiagnosticSchema.array().max(MAX_EXAM_IMPORT_DIAGNOSTICS).safeParse(value);
  if (!parsed.success || parsed.data.some((finding) => finding.tier !== 'assisted')) {
    return { findings: [invalidAssistedFinding()], accepted: false };
  }

  return { findings: parsed.data, accepted: true };
}

function buildDraftIndex(draft: ExamImportDraft): DraftIndex {
  const questions = draft.sections.flatMap((section) => section.questions);

  return {
    sharedContentIds: new Set(draft.sharedContents.map((content) => content.id)),
    sectionIds: new Set(draft.sections.map((section) => section.id)),
    questionsById: new Map(questions.map((question) => [question.id, question])),
    optionIdsByQuestionId: new Map(
      questions
        .filter((question): question is Extract<ExamImportQuestion, { kind: 'choice' }> => question.kind === 'choice')
        .map((question) => [question.id, new Set(question.options.map((option) => option.id))])
    ),
    statementIdsByQuestionId: new Map(
      questions
        .filter(
          (question): question is Extract<ExamImportQuestion, { kind: 'true_false_group' }> =>
            question.kind === 'true_false_group'
        )
        .map((question) => [question.id, new Set(question.statements.map((statement) => statement.id))])
    )
  };
}

function fieldTargetExists(target: ExamImportFieldTarget, index: DraftIndex): boolean {
  switch (target.kind) {
    case 'draft_field':
      return true;
    case 'shared_content_field':
      return index.sharedContentIds.has(target.contentId);
    case 'section_field':
      return index.sectionIds.has(target.sectionId);
    case 'question_field':
      return index.questionsById.has(target.questionId);
    case 'option_field':
      return index.optionIdsByQuestionId.get(target.questionId)?.has(target.optionId) ?? false;
    case 'statement_field':
      return index.statementIdsByQuestionId.get(target.questionId)?.has(target.statementId) ?? false;
  }

  target satisfies never;
  return false;
}

function targetQuestionId(target: ExamImportFieldTarget): string | null {
  switch (target.kind) {
    case 'question_field':
    case 'option_field':
    case 'statement_field':
      return target.questionId;
    case 'draft_field':
    case 'shared_content_field':
    case 'section_field':
      return null;
  }

  target satisfies never;
  return null;
}

function targetIdentity(target: ExamImportFieldTarget): string {
  switch (target.kind) {
    case 'draft_field':
      return `${target.kind}:${target.field}`;
    case 'shared_content_field':
      return `${target.kind}:${target.contentId}:${target.field}`;
    case 'section_field':
      return `${target.kind}:${target.sectionId}:${target.field}`;
    case 'question_field':
      return `${target.kind}:${target.questionId}:${target.field}`;
    case 'option_field':
      return `${target.kind}:${target.questionId}:${target.optionId}:${target.field}`;
    case 'statement_field':
      return `${target.kind}:${target.questionId}:${target.statementId}:${target.field}`;
  }

  target satisfies never;
  return '';
}

function collectDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }

  return [...duplicates];
}

function visibleText(html: string): string {
  return normalizeComparableText(html.replace(/<[^>]*>/g, ' '));
}

function hasRenderableHtml(html: string): boolean {
  return (
    visibleText(html).length > 0 ||
    /<(?:img|table|audio|video)\b/i.test(html) ||
    /data-type=(?:"|')(?:inline-math|block-math)(?:"|')/i.test(html)
  );
}

function contentIdentity(html: string): string {
  const text = visibleText(html);

  return text.length > 0 ? text : normalizeComparableText(html);
}

const confidenceRank = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  teacher_confirmed: 4
} as const;

function collectFieldStateFindings(draft: ExamImportDraft, index: DraftIndex): ExamImportDiagnostic[] {
  const findings: ExamImportDiagnostic[] = [];
  const targetIds = draft.fieldStates.map((state) => targetIdentity(state.target));

  if (collectDuplicates(targetIds).length > 0) {
    findings.push(diagnostic('DUPLICATE_FIELD_STATE', 'Each draft field can have only one field state'));
  }

  for (const fieldState of draft.fieldStates) {
    const questionId = targetQuestionId(fieldState.target);
    const question = questionId === null ? null : (index.questionsById.get(questionId) ?? null);
    if (!fieldTargetExists(fieldState.target, index)) {
      findings.push(
        diagnostic(
          'DANGLING_FIELD_TARGET',
          'Field state must reference an existing draft field',
          question,
          fieldState.target
        )
      );
    }
    if (fieldState.origin === 'ai' && confidenceRank[fieldState.confidence] > confidenceRank.low) {
      findings.push(
        diagnostic(
          'AI_CONFIDENCE_TOO_HIGH',
          'AI-derived fields cannot exceed low confidence',
          question,
          fieldState.target
        )
      );
    }
    const teacherStateMatches = (fieldState.origin === 'teacher') === (fieldState.confidence === 'teacher_confirmed');
    if (!teacherStateMatches) {
      findings.push(
        diagnostic(
          'TEACHER_CONFIRMATION_MISMATCH',
          'Teacher-confirmed confidence and teacher origin must be used together',
          question,
          fieldState.target
        )
      );
    }
  }

  for (const question of index.questionsById.values()) {
    const questionStates = draft.fieldStates.filter(
      (fieldState) => targetQuestionId(fieldState.target) === question.id
    );
    const lowestFieldConfidence = questionStates.reduce<number | null>((lowest, fieldState) => {
      const rank = confidenceRank[fieldState.confidence];
      return lowest === null ? rank : Math.min(lowest, rank);
    }, null);
    if (lowestFieldConfidence !== null && confidenceRank[question.confidence] > lowestFieldConfidence) {
      findings.push(
        diagnostic(
          'QUESTION_CONFIDENCE_TOO_HIGH',
          'Question confidence cannot exceed its least certain field',
          question
        )
      );
    }
  }

  return findings;
}

function sortedIdentity(values: readonly string[]): string {
  return [...values].sort().join('\u0000');
}

function booleanAnswerIdentity(answers: readonly { statementId: string; correctValue: boolean }[]): string {
  return [...answers]
    .sort((left, right) => left.statementId.localeCompare(right.statementId))
    .map((answer) => `${answer.statementId}:${answer.correctValue ? '1' : '0'}`)
    .join('\u0000');
}

function collectCandidateSelectionFindings(question: ExamImportQuestion): ExamImportDiagnostic[] {
  if (question.kind === 'essay' || question.kind === 'unresolved') return [];

  const findings: ExamImportDiagnostic[] = [];
  const candidateIds = question.answerCandidates.map((candidate) => candidate.id);
  if (collectDuplicates(candidateIds).length > 0) {
    findings.push(
      diagnostic('DUPLICATE_ANSWER_CANDIDATE_ID', 'Answer candidate IDs must be unique within a question', question)
    );
  }
  if (question.answerKey === null) return findings;

  const selectedCandidateIds = question.answerKey.selectedCandidateIds;
  const conflictingCandidateIds = question.answerKey.conflictingCandidateIds;
  const declaredCandidateIds = new Set(candidateIds);
  if (
    [...selectedCandidateIds, ...conflictingCandidateIds].some((candidateId) => !declaredCandidateIds.has(candidateId))
  ) {
    findings.push(
      diagnostic('DANGLING_ANSWER_CANDIDATE', 'Answer key must reference candidates declared on the question', question)
    );
  }
  if (
    selectedCandidateIds.some((candidateId) => conflictingCandidateIds.includes(candidateId)) ||
    collectDuplicates(selectedCandidateIds).length > 0 ||
    collectDuplicates(conflictingCandidateIds).length > 0
  ) {
    findings.push(
      diagnostic(
        'INVALID_ANSWER_CANDIDATE_SELECTION',
        'Selected and conflicting candidate IDs must be unique and disjoint',
        question
      )
    );
  }

  switch (question.answerKey.agreement) {
    case 'single_source':
      if (selectedCandidateIds.length !== 1 || conflictingCandidateIds.length !== 0) {
        findings.push(
          diagnostic(
            'INVALID_ANSWER_AGREEMENT',
            'Single-source agreement requires one selected candidate and no conflict',
            question
          )
        );
      }
      break;
    case 'unanimous':
      if (selectedCandidateIds.length < 2 || conflictingCandidateIds.length !== 0) {
        findings.push(
          diagnostic(
            'INVALID_ANSWER_AGREEMENT',
            'Unanimous agreement requires at least two selected candidates and no conflict',
            question
          )
        );
      }
      break;
    case 'conflict':
      if (conflictingCandidateIds.length === 0) {
        findings.push(
          diagnostic(
            'INVALID_ANSWER_AGREEMENT',
            'Conflict agreement requires at least one conflicting candidate',
            question
          )
        );
      }
      break;
  }

  return findings;
}

function collectAnswerKeyFindings(question: ExamImportQuestion): ExamImportDiagnostic[] {
  const findings = collectCandidateSelectionFindings(question);
  if (question.kind === 'essay' || question.kind === 'unresolved') return findings;
  if (question.answerKey === null) {
    if (question.kind === 'choice') {
      const optionIds = new Set(question.options.map((option) => option.id));
      if (
        question.answerCandidates.some((candidate) =>
          candidate.correctOptionIds.some((optionId) => !optionIds.has(optionId))
        )
      ) {
        findings.push(
          diagnostic('ANSWER_OPTION_NOT_FOUND', 'Choice answers must reference declared options', question)
        );
      }
    }
    if (question.kind === 'true_false_group') {
      const statementIds = new Set(question.statements.map((statement) => statement.id));
      if (
        question.answerCandidates.some((candidate) =>
          candidate.answers.some((answer) => !statementIds.has(answer.statementId))
        )
      ) {
        findings.push(
          diagnostic('ANSWER_STATEMENT_NOT_FOUND', 'True/false candidates must reference declared statements', question)
        );
      }
    }

    return findings;
  }

  const selectedIds = new Set(question.answerKey.selectedCandidateIds);
  const conflictingIds = new Set(question.answerKey.conflictingCandidateIds);
  let selectedMismatch = false;
  let invalidConflict = false;

  if (question.kind === 'choice') {
    const optionIds = new Set(question.options.map((option) => option.id));
    const referencedOptionIds = [
      ...question.answerKey.correctOptionIds,
      ...question.answerCandidates.flatMap((candidate) => candidate.correctOptionIds)
    ];
    if (referencedOptionIds.some((optionId) => !optionIds.has(optionId))) {
      findings.push(diagnostic('ANSWER_OPTION_NOT_FOUND', 'Choice answers must reference declared options', question));
    }
    if (question.cardinality === 'single' && question.answerKey.correctOptionIds.length !== 1) {
      findings.push(
        diagnostic('INVALID_CHOICE_CARDINALITY', 'Single-choice questions require exactly one correct option', question)
      );
    }
    if (question.scoreWeights) {
      const weightedOptionIds = Object.keys(question.scoreWeights);
      if (
        weightedOptionIds.length !== optionIds.size ||
        weightedOptionIds.some((weightedOptionId) => !optionIds.has(weightedOptionId))
      ) {
        findings.push(
          diagnostic('INVALID_CHOICE_SCORE_WEIGHTS', 'Choice score weights must define every option', question)
        );
      }
      if (question.answerKey.correctOptionIds.some((optionId) => question.scoreWeights?.[optionId]! <= 0)) {
        findings.push(
          diagnostic(
            'INVALID_CHOICE_SCORE_WEIGHTS',
            'Correct choice options must have positive score weights',
            question
          )
        );
      }
    }
    if (question.feedback?.some((feedback) => feedback.optionId !== null && !optionIds.has(feedback.optionId))) {
      findings.push(diagnostic('ANSWER_OPTION_NOT_FOUND', 'Choice feedback must reference declared options', question));
    }

    const keyIdentity = sortedIdentity(question.answerKey.correctOptionIds);
    for (const candidate of question.answerCandidates) {
      const candidateIdentity = sortedIdentity(candidate.correctOptionIds);
      if (selectedIds.has(candidate.id) && candidateIdentity !== keyIdentity) selectedMismatch = true;
      if (conflictingIds.has(candidate.id) && candidateIdentity === keyIdentity) invalidConflict = true;
    }
  }

  if (question.kind === 'true_false_group') {
    const statementIds = new Set(question.statements.map((statement) => statement.id));
    const keyStatementIds = question.answerKey.answers.map((answer) => answer.statementId);
    if (
      keyStatementIds.length !== statementIds.size ||
      collectDuplicates(keyStatementIds).length > 0 ||
      keyStatementIds.some((statementId) => !statementIds.has(statementId))
    ) {
      findings.push(
        diagnostic(
          'INVALID_TRUE_FALSE_ANSWER_KEY',
          'True/false answer keys must answer every declared statement once',
          question
        )
      );
    }
    if (
      question.answerCandidates.some((candidate) =>
        candidate.answers.some((answer) => !statementIds.has(answer.statementId))
      )
    ) {
      findings.push(
        diagnostic('ANSWER_STATEMENT_NOT_FOUND', 'True/false candidates must reference declared statements', question)
      );
    }

    const keyIdentity = booleanAnswerIdentity(question.answerKey.answers);
    for (const candidate of question.answerCandidates) {
      const candidateIdentity = booleanAnswerIdentity(candidate.answers);
      if (selectedIds.has(candidate.id) && candidateIdentity !== keyIdentity) selectedMismatch = true;
      if (conflictingIds.has(candidate.id) && candidateIdentity === keyIdentity) invalidConflict = true;
    }
  }

  if (question.kind === 'short_answer') {
    const normalizedAnswers = question.answerKey.acceptedAnswers.map(normalizeComparableText);
    if (collectDuplicates(normalizedAnswers).length > 0) {
      findings.push(
        diagnostic('DUPLICATE_ACCEPTED_ANSWER', 'Accepted short answers must be unique after normalization', question)
      );
    }

    const keyIdentity = sortedIdentity(normalizedAnswers);
    for (const candidate of question.answerCandidates) {
      const candidateIdentity = sortedIdentity(candidate.acceptedAnswers.map(normalizeComparableText));
      if (selectedIds.has(candidate.id) && candidateIdentity !== keyIdentity) selectedMismatch = true;
      if (conflictingIds.has(candidate.id) && candidateIdentity === keyIdentity) invalidConflict = true;
    }
  }

  if (question.kind === 'numeric') {
    const keyIdentity = `${question.answerKey.value}:${question.answerKey.tolerance ?? 'null'}`;
    for (const candidate of question.answerCandidates) {
      const candidateIdentity = `${candidate.value}:${candidate.tolerance ?? 'null'}`;
      if (selectedIds.has(candidate.id) && candidateIdentity !== keyIdentity) selectedMismatch = true;
      if (conflictingIds.has(candidate.id) && candidateIdentity === keyIdentity) invalidConflict = true;
    }
  }

  if (selectedMismatch) {
    findings.push(
      diagnostic('ANSWER_KEY_CANDIDATE_MISMATCH', 'Answer key value must match every selected candidate', question)
    );
  }
  if (invalidConflict) {
    findings.push(
      diagnostic(
        'INVALID_CONFLICTING_CANDIDATE',
        'Conflicting candidates must differ from the selected answer key',
        question
      )
    );
  }

  return findings;
}

function hasTeacherConfirmedAnswerKey(draft: ExamImportDraft, questionId: string): boolean {
  return draft.fieldStates.some(
    (fieldState) =>
      fieldState.target.kind === 'question_field' &&
      fieldState.target.questionId === questionId &&
      fieldState.target.field === 'answerKey' &&
      fieldState.origin === 'teacher' &&
      fieldState.confidence === 'teacher_confirmed'
  );
}

function expectedQuestionReview(
  draft: ExamImportDraft,
  question: ExamImportQuestion,
  findings: readonly ExamImportDiagnostic[]
): ExamImportQuestion['review'] {
  const existingQuestionDiagnostics = draft.diagnostics.filter((candidate) => candidate.questionId === question.id);

  if (
    question.kind === 'unresolved' ||
    question.confidence === 'none' ||
    (requiresExamImportAnswerKey(question) && question.answerKey === null)
  ) {
    return 'unresolved';
  }

  const hasAiField = draft.fieldStates.some(
    (fieldState) => targetQuestionId(fieldState.target) === question.id && fieldState.origin === 'ai'
  );
  return question.confidence === 'low' || findings.length > 0 || existingQuestionDiagnostics.length > 0 || hasAiField
    ? 'needs_attention'
    : 'clean';
}

function collectQuestionFindings(
  draft: ExamImportDraft,
  question: ExamImportQuestion,
  context: ExamImportSemanticValidationContext,
  index: DraftIndex
): ExamImportDiagnostic[] {
  const findings: ExamImportDiagnostic[] = [];

  if (question.passageId !== null && !index.sharedContentIds.has(question.passageId)) {
    findings.push(
      diagnostic(
        'DANGLING_SHARED_CONTENT',
        'Question shared-content reference must point to a declared passage or table content',
        question,
        { kind: 'question_field', questionId: question.id, field: 'passageId' }
      )
    );
  }

  if (question.kind === 'unresolved') {
    const hasBlockingDiagnostic = draft.diagnostics.some(
      (candidate) => candidate.questionId === question.id && candidate.blocking
    );
    if (!hasBlockingDiagnostic) {
      findings.push(
        diagnostic('UNRESOLVED_QUESTION_NOT_BLOCKED', 'Unresolved questions require a blocking diagnostic', question)
      );
    }
  } else if (!context.enabledQuestionKinds.has(question.kind)) {
    findings.push(
      diagnostic(
        'QUESTION_KIND_DISABLED',
        'Question kind is not enabled for publishing in this organization',
        question,
        {
          kind: 'question_field',
          questionId: question.id,
          field: 'kind'
        }
      )
    );
  }

  if (!hasRenderableHtml(question.promptHtml)) {
    findings.push(diagnostic('EMPTY_QUESTION_PROMPT', 'Question prompt must contain renderable content', question));
  }

  if (question.kind === 'choice') {
    if (collectDuplicates(question.options.map((option) => option.id)).length > 0) {
      findings.push(diagnostic('DUPLICATE_OPTION_ID', 'Choice option IDs must be unique', question));
    }
    if (collectDuplicates(question.options.map((option) => String(option.order))).length > 0) {
      findings.push(diagnostic('DUPLICATE_OPTION_ORDER', 'Choice option order values must be unique', question));
    }
    if (collectDuplicates(question.options.map((option) => normalizeComparableText(option.sourceLabel))).length > 0) {
      findings.push(
        diagnostic('DUPLICATE_OPTION_SOURCE_LABEL', 'Choice option source labels must be unique', question)
      );
    }
    if (question.options.some((option) => !hasRenderableHtml(option.html))) {
      findings.push(diagnostic('EMPTY_OPTION_CONTENT', 'Choice options must contain renderable content', question));
    }
    if (collectDuplicates(question.options.map((option) => contentIdentity(option.html))).length > 0) {
      findings.push(diagnostic('DUPLICATE_OPTION_TEXT', 'Choice options must contain distinct content', question));
    }
  }

  if (question.kind === 'true_false_group') {
    if (collectDuplicates(question.statements.map((statement) => statement.id)).length > 0) {
      findings.push(diagnostic('DUPLICATE_STATEMENT_ID', 'True/false statement IDs must be unique', question));
    }
    if (collectDuplicates(question.statements.map((statement) => String(statement.order))).length > 0) {
      findings.push(
        diagnostic('DUPLICATE_STATEMENT_ORDER', 'True/false statement order values must be unique', question)
      );
    }
    if (question.statements.some((statement) => !hasRenderableHtml(statement.html))) {
      findings.push(
        diagnostic('EMPTY_STATEMENT_CONTENT', 'True/false statements must contain renderable content', question)
      );
    }
    if (question.scoring.mode === 'tiered') {
      const tiers = question.scoring.tiers;
      const tierCountMismatch = tiers.length !== question.statements.length + 1;
      const hasDecreasingTier = tiers.some((tier, tierIndex) => tierIndex > 0 && tier < tiers[tierIndex - 1]!);
      const invalidEndpoints = tiers[0] !== 0 || tiers.at(-1) !== 1;
      if (tierCountMismatch || hasDecreasingTier || invalidEndpoints) {
        findings.push(
          diagnostic(
            'INVALID_TRUE_FALSE_SCORING',
            'Tiered scoring must cover every correct count, start at zero, end at one, and never decrease',
            question
          )
        );
      }
    }
  }

  if (question.kind === 'unresolved' && !hasRenderableHtml(question.rawHtml)) {
    findings.push(diagnostic('EMPTY_UNRESOLVED_CONTENT', 'Unresolved source content cannot be empty', question));
  }

  findings.push(...collectAnswerKeyFindings(question));

  const missingAnswerAlreadyReported = draft.diagnostics.some(
    (candidate) =>
      candidate.questionId === question.id &&
      (candidate.code === 'ANSWER_KEY_MISSING' || candidate.code === 'MISSING_ANSWER_KEY')
  );
  if (requiresExamImportAnswerKey(question) && question.answerKey === null && !missingAnswerAlreadyReported) {
    findings.push(diagnostic('MISSING_ANSWER_KEY', 'Question requires an answer key before publishing', question));
  }

  if (question.kind !== 'essay' && question.kind !== 'unresolved' && question.answerKey !== null) {
    const answerKey = question.answerKey;
    const selectedCandidates = question.answerCandidates.filter((candidate) =>
      answerKey.selectedCandidateIds.includes(candidate.id)
    );
    const teacherConfirmed = hasTeacherConfirmedAnswerKey(draft, question.id);
    if (selectedCandidates.some((candidate) => candidate.source === 'ai') && !teacherConfirmed) {
      findings.push(
        diagnostic('AI_ANSWER_REQUIRES_CONFIRMATION', 'AI-derived answers require teacher confirmation', question)
      );
    }
    if (answerKey.agreement === 'conflict' && !teacherConfirmed) {
      findings.push(
        diagnostic(
          'ANSWER_CONFLICT_REQUIRES_CONFIRMATION',
          'Conflicting answer sources require teacher confirmation',
          question
        )
      );
    }
  }

  const expectedReview = expectedQuestionReview(draft, question, findings);
  if (question.review !== expectedReview) {
    findings.push(diagnostic('STALE_REVIEW_STATE', `Question review state must be "${expectedReview}"`, question));
  }

  return findings;
}

export function synchronizeExamImportDraftReviewStates(
  draft: ExamImportDraft,
  context: ExamImportSemanticValidationContext
): ExamImportDraft {
  const next = examImportDraftSchema.parse(structuredClone(draft));
  const index = buildDraftIndex(next);

  for (const section of next.sections) {
    for (const question of section.questions) {
      const findings = collectQuestionFindings(next, question, context, index).filter(
        (finding) => finding.code !== 'STALE_REVIEW_STATE'
      );
      question.review = expectedQuestionReview(next, question, findings);
    }
  }

  return examImportDraftSchema.parse(next);
}

export function collectExamImportSemanticFindings(
  draft: ExamImportDraft,
  context: ExamImportSemanticValidationContext
): ExamImportDiagnostic[] {
  const findings: ExamImportDiagnostic[] = [];
  const index = buildDraftIndex(draft);
  const questions = draft.sections.flatMap((section) => section.questions);

  if (questions.length > MAX_EXAM_IMPORT_TOTAL_QUESTIONS) {
    findings.push(
      diagnostic('TOO_MANY_QUESTIONS', `Draft cannot contain more than ${MAX_EXAM_IMPORT_TOTAL_QUESTIONS} questions`)
    );
  }

  if (
    collectDuplicates([
      ...draft.sharedContents.map((content) => content.id),
      ...draft.sections.map((section) => section.id),
      ...questions.map((question) => question.id)
    ]).length > 0
  ) {
    findings.push(diagnostic('DUPLICATE_DRAFT_ID', 'Draft entity IDs must be globally unique'));
  }

  if (collectDuplicates(draft.sections.map((section) => String(section.order))).length > 0) {
    findings.push(diagnostic('DUPLICATE_SECTION_ORDER', 'Section order values must be unique'));
  }

  for (const section of draft.sections) {
    if (collectDuplicates(section.questions.map((question) => String(question.order))).length > 0) {
      findings.push(diagnostic('DUPLICATE_QUESTION_ORDER', 'Question order values must be unique within a section'));
    }
  }

  for (const sharedContent of draft.sharedContents) {
    if (!hasRenderableHtml(sharedContent.html)) {
      findings.push(diagnostic('EMPTY_SHARED_CONTENT', 'Shared content must contain renderable content'));
    }
  }

  for (const question of questions) {
    findings.push(...collectQuestionFindings(draft, question, context, index));
  }

  findings.push(...collectFieldStateFindings(draft, index));

  for (const draftDiagnostic of draft.diagnostics) {
    if (draftDiagnostic.target !== null && !fieldTargetExists(draftDiagnostic.target, index)) {
      findings.push(
        diagnostic(
          'DANGLING_DIAGNOSTIC_TARGET',
          'Diagnostic target must reference an existing draft field',
          draftDiagnostic.questionId === null ? null : (index.questionsById.get(draftDiagnostic.questionId) ?? null),
          draftDiagnostic.target
        )
      );
    }
    if (draftDiagnostic.questionId !== null && !index.questionsById.has(draftDiagnostic.questionId)) {
      findings.push(diagnostic('DANGLING_DIAGNOSTIC_QUESTION', 'Diagnostic must reference an existing question'));
    }
    const targetOwnerQuestionId = draftDiagnostic.target === null ? null : targetQuestionId(draftDiagnostic.target);
    if (targetOwnerQuestionId !== null && draftDiagnostic.questionId !== targetOwnerQuestionId) {
      findings.push(
        diagnostic(
          'DIAGNOSTIC_TARGET_OWNERSHIP_MISMATCH',
          'Diagnostic question must own its question-scoped field target',
          draftDiagnostic.questionId === null ? null : (index.questionsById.get(draftDiagnostic.questionId) ?? null),
          draftDiagnostic.target
        )
      );
    }
  }

  return findings;
}

export function validateExamImportDraftStructure(
  value: unknown,
  sanitizeHtml: (html: string) => string
): ExamImportStructuralValidationResult {
  const parsed = examImportDraftSchema.safeParse(value);
  if (!parsed.success) {
    return {
      draft: null,
      findings: parsed.error.issues.map((issue) => structuralDiagnostic(issue.path, issue.message))
    };
  }

  let sanitized: ExamImportDraft;
  try {
    sanitized = mapExamImportDraftHtml(parsed.data, sanitizeHtml);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sanitization error';

    return {
      draft: null,
      findings: [structuralDiagnostic([], `HTML sanitization failed: ${message}`)]
    };
  }

  const reparsed = examImportDraftSchema.safeParse(sanitized);
  if (!reparsed.success) {
    return {
      draft: null,
      findings: reparsed.error.issues.map((issue) => structuralDiagnostic(issue.path, issue.message))
    };
  }

  return { draft: reparsed.data, findings: [] };
}

export function validateExamImportDraft(
  value: unknown,
  context: ExamImportValidationContext
): ExamImportValidationResult {
  const structural = validateExamImportDraftStructure(value, context.sanitizeHtml);
  if (structural.draft === null) {
    return {
      draft: null,
      findings: structural.findings,
      publishable: false
    };
  }

  const findings = [...structural.draft.diagnostics, ...collectExamImportSemanticFindings(structural.draft, context)];

  return {
    draft: structural.draft,
    findings,
    publishable: !findings.some((finding) => finding.blocking)
  };
}
