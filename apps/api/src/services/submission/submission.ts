import type {
  AnswerData,
  AssessmentGradingMode,
  AssessmentDeliveryDefinition,
  AssessmentItemDefinition,
  FileUploadAnswerData,
  ReleasedAssessmentFeedback,
  VideoRecordingAnswerData
} from '@cio/question-types';
import {
  deriveItemCapabilities,
  assessmentResponseEnvelopeSchema,
  getUnsupportedAssessmentVerticalSliceInteractionKinds,
  parseAssessmentItemDefinition,
  QUESTION_TYPE_IDS,
  roundToTwoDecimals,
  resolveReleasedAssessmentFeedback,
  scoreAssessmentVerticalSlice,
  scoreSubmissionAnswers,
  toAssessmentDeliveryDefinition,
  validateAssessmentResponseEnvelope,
  type ScoreSubmissionResult
} from '@cio/question-types';
import { AppError, ErrorCodes } from '@api/utils/errors';
import type { TNewQuestionAnswer, TNewSubmission, TQuestionAnswer, TSubmission } from '@cio/db/types';
import type {
  TSubmissionAnswerUpdate,
  TSubmissionGradesUpdate,
  TSubmissionUpdate
} from '@cio/utils/validation/submission';
import { buildEmailBranding, buildEmailFromName } from '@cio/email';
import { enqueueTransactionalEmail } from '@api/services/jobs';
import {
  createSubmission,
  deleteSubmission,
  getQuestionAnswersBySubmissionId,
  getSubmissionById,
  getSubmissionByIdempotencyKey,
  getSubmissionsByCourseIdWithDetails,
  getSubmissionsForGrading,
  hasSubmission,
  insertQuestionAnswersBatch,
  updateSubmission,
  updateSubmissionGrades
} from '@cio/db/queries/submission';
import { createAssetUsage, deleteAssetUsagesByTarget, lockAssetById } from '@cio/db/queries/assets';
import { getQuestionTypeById, requiresManualGrading } from '@cio/question-types';
import { getCourseById, getCourseWithOrgData } from '@cio/db/queries/course';
import { getCourseTeachers, getProfileByGroupMemberId } from '@cio/db/queries/course/people';
import {
  getExerciseById,
  getExerciseWithRelationsOptimized,
  getCurrentQuestionRevision,
  getQuestionRevisionsByIds,
  resolveGroupMemberExerciseAccess
} from '@cio/db/queries/exercise';
import {
  materializeLegacyQuestionRevision,
  resolveAttemptedQuestionSet
} from '@cio/core/services/assessment/question-revision';
import { getGroupMemberIdByCourseAndProfile, isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';

import { getDashboardBaseUrl } from '@cio/core/config/dashboard-url';
import { generateDocumentDownloadPresignedUrls, generateVideoDownloadPresignedUrls } from '@cio/core/utils/s3';
import { syncComplianceProgressFromSubmission } from '@api/services/course/compliance';
import { evaluateCourseCertification } from '@api/services/course/completion';
import { isExerciseCompletedForMember } from '@cio/db/queries/course/progression';
import { createNotification } from '@cio/db/queries/notifications';
import { emitWebhookEvent } from '@api/services/webhook';
import { db, type DbOrTxClient } from '@cio/db/drizzle';
import { lockExerciseAssignmentState } from '@cio/db/queries/exercise';
import { getCourseOrganizationId } from '@cio/db/queries/tag';
import {
  EXERCISE_SUBMISSION_MAX_TOTAL_ANSWER_CHARACTERS,
  getExerciseSubmissionPayloadCharacterCount
} from '@cio/utils/validation/exercise';
import { prepareSubmissionAnswers, type SubmissionAnswerPayload } from './submission-answer-processing';
import { prepareSubmissionGrades } from './submission-grading-validation';
import { getCourseSubmissionOrThrow, lockCourseSubmissionOrThrow } from './submission-ownership';
import { hasExerciseAnswerAssetOwnership } from '../exercise/exercise-answer-asset-ownership';

type SubmissionGradingState = 'queued' | 'processing' | 'awaiting_manual' | 'completed' | 'failed';
type SubmissionOverallStatus = 'auto_graded' | 'manual_required' | 'hybrid';

async function triggerCertificationIfExerciseComplete(
  courseId: string,
  exerciseId: string,
  groupMemberId: string
): Promise<void> {
  const profile = await getProfileByGroupMemberId(groupMemberId);
  if (!profile?.id) return;

  const isComplete = await isExerciseCompletedForMember(exerciseId, groupMemberId);
  if (!isComplete) return;

  void evaluateCourseCertification(courseId, profile.id).catch((certError) => {
    console.error('Failed to evaluate course certification after exercise submission:', certError);
  });
}

const LEGACY_BOARD_STATUS_LABELS: Record<number, string> = {
  1: 'Submitted',
  2: 'In Progress',
  3: 'Graded'
};

const LEGACY_STATUS_TO_GRADING_STATE: Record<number, SubmissionGradingState> = {
  1: 'queued',
  2: 'processing',
  3: 'completed'
};

const GRADING_STATE_TO_LEGACY_STATUS: Record<SubmissionGradingState, number> = {
  queued: 1,
  processing: 2,
  awaiting_manual: 2,
  failed: 2,
  completed: 3
};

const ALLOWED_GRADING_TRANSITIONS: Record<SubmissionGradingState, SubmissionGradingState[]> = {
  queued: ['processing'],
  processing: ['completed', 'awaiting_manual', 'failed'],
  awaiting_manual: ['completed'],
  failed: ['queued'],
  completed: []
};

function projectLegacyStatusId(gradingState: SubmissionGradingState): number {
  return GRADING_STATE_TO_LEGACY_STATUS[gradingState];
}

function resolveSubmissionGradingState(submission: Partial<TSubmission>): SubmissionGradingState {
  const rawState = typeof submission.gradingState === 'string' ? submission.gradingState : '';
  if (rawState && rawState in GRADING_STATE_TO_LEGACY_STATUS) {
    return rawState as SubmissionGradingState;
  }

  const legacyStatusId = Number(submission.statusId ?? 1);
  return LEGACY_STATUS_TO_GRADING_STATE[legacyStatusId] ?? 'queued';
}

/**
 * Grading mode of one attempted question: canonical capabilities only for
 * ASSESSMENT_ITEM; legacy types keep their registry grading behavior after
 * revision materialization. Unknown type ids stay conservative.
 */
function resolveQuestionGradingMode(
  questionTypeId: number,
  definition: AssessmentItemDefinition | undefined
): AssessmentGradingMode {
  if (questionTypeId !== QUESTION_TYPE_IDS.ASSESSMENT_ITEM) {
    const metadata = getQuestionTypeById(questionTypeId);
    if (!metadata) return 'manual';

    return requiresManualGrading(metadata.key) ? 'manual' : 'auto';
  }

  if (!definition) return 'manual';

  // Persisted future interactions stay manual until their scorer ships.
  if (getUnsupportedAssessmentVerticalSliceInteractionKinds(definition).length > 0) return 'manual';

  return deriveItemCapabilities(definition).gradingMode;
}

function combineGradingModes(gradingModes: readonly AssessmentGradingMode[]): SubmissionOverallStatus {
  const hasManual = gradingModes.some((mode) => mode !== 'auto');
  const hasAuto = gradingModes.some((mode) => mode !== 'manual');

  if (hasManual && hasAuto) return 'hybrid';
  if (hasManual) return 'manual_required';
  return 'auto_graded';
}

/**
 * Batch-loads and parses the stored definitions of the materialized attempted
 * revisions. Every id in the map was just materialized, so a missing row is an
 * integrity failure (500) — never a silent capability fallback; a corrupt
 * stored definition also fails explicitly naming the offending revision.
 */
async function loadAttemptedDefinitions(
  revisionIdByQuestionId: ReadonlyMap<number, string>,
  dbClient: DbOrTxClient
): Promise<Map<number, AssessmentItemDefinition>> {
  const revisionIds = [...new Set(revisionIdByQuestionId.values())];
  const revisionRows = await getQuestionRevisionsByIds(revisionIds, dbClient);
  const revisionsById = new Map(revisionRows.map((revision) => [revision.id, revision]));

  const definitionByQuestionId = new Map<number, AssessmentItemDefinition>();
  for (const [questionId, revisionId] of revisionIdByQuestionId) {
    const revision = revisionsById.get(revisionId);
    if (!revision) {
      console.error(
        `loadAttemptedDefinitions: materialized revision "${revisionId}" for question "${questionId}" was not returned by the batch lookup`
      );
      throw new AppError(
        `Attempted question revision "${revisionId}" could not be loaded`,
        ErrorCodes.INTERNAL_ERROR,
        500
      );
    }

    const parsed = parseAssessmentItemDefinition(revision.definition);
    if (!parsed.success) {
      console.error(
        `loadAttemptedDefinitions: revision "${revisionId}" for question "${questionId}" holds an invalid stored definition`
      );
      throw new AppError(
        `Attempted question revision "${revisionId}" holds an invalid stored definition`,
        ErrorCodes.INTERNAL_ERROR,
        500
      );
    }

    definitionByQuestionId.set(questionId, parsed.data);
  }

  return definitionByQuestionId;
}

function resolveOverallStatusFromQuestionTypeIds(questionTypeIds: number[]): SubmissionOverallStatus {
  const manualFlags = questionTypeIds.map((questionTypeId) => {
    const metadata = getQuestionTypeById(questionTypeId);
    if (!metadata) return true;
    return requiresManualGrading(metadata.key);
  });

  const hasManual = manualFlags.some(Boolean);
  const hasAuto = manualFlags.some((value) => !value);

  if (hasManual && hasAuto) return 'hybrid';
  if (hasManual) return 'manual_required';
  return 'auto_graded';
}

function resolveRequestedGradingState(data: TSubmissionUpdate): SubmissionGradingState | null {
  if (data.gradingState) {
    return data.gradingState;
  }

  if (data.statusId === undefined) {
    return null;
  }

  const mapped = LEGACY_STATUS_TO_GRADING_STATE[Number(data.statusId)];
  if (!mapped) {
    throw new AppError('Invalid submission status', ErrorCodes.VALIDATION_ERROR, 400);
  }

  return mapped;
}

function isAllowedGradingTransition(from: SubmissionGradingState, to: SubmissionGradingState): boolean {
  if (from === to) return true;
  return ALLOWED_GRADING_TRANSITIONS[from]?.includes(to) ?? false;
}

function isFileUpload(data: unknown): data is FileUploadAnswerData {
  return !!data && typeof data === 'object' && (data as { type: string }).type === 'FILE_UPLOAD';
}

function isVideoRecording(data: unknown): data is VideoRecordingAnswerData {
  return !!data && typeof data === 'object' && (data as { type: string }).type === 'VIDEO_RECORDING';
}

/**
 * Enriches FILE_UPLOAD answers from DB rows (question_answer[]) with presigned download URLs.
 * Used by getSubmission and listSubmissionsByExercise.
 */
async function enrichFileUploadAnswersArray<T extends { answerData?: unknown }>(answers: T[]): Promise<T[]> {
  const fileKeys = answers
    .map((a) => a.answerData)
    .filter(isFileUpload)
    .map((d) => d.fileKey);
  const videoKeys = answers
    .map((a) => a.answerData)
    .filter(isVideoRecording)
    .map((d) => d.storageKey);

  if (fileKeys.length === 0 && videoKeys.length === 0) return answers;

  try {
    const [documentUrls, videoUrls] = await Promise.all([
      generateDocumentDownloadPresignedUrls(fileKeys),
      generateVideoDownloadPresignedUrls(videoKeys)
    ]);
    return answers.map((answer) => {
      if (isFileUpload(answer.answerData)) {
        const url = documentUrls[answer.answerData.fileKey];
        return url ? { ...answer, answerData: { ...answer.answerData, fileUrl: url } } : answer;
      }

      if (!isVideoRecording(answer.answerData)) return answer;
      const url = videoUrls[answer.answerData.storageKey];
      return url ? { ...answer, answerData: { ...answer.answerData, playbackUrl: url } } : answer;
    });
  } catch (error) {
    console.error('enrichFileUploadAnswersArray error:', error);
    return answers;
  }
}

/**
 * Enriches FILE_UPLOAD entries in a { questionName → AnswerData } map with presigned download URLs.
 * Used by getSubmissionsForGradingEmail to build the grading email payload.
 */
async function enrichFileUploadAnswersObject(answers: Record<string, AnswerData>): Promise<Record<string, AnswerData>> {
  const fileKeys = Object.values(answers)
    .filter(isFileUpload)
    .map((d) => d.fileKey);
  const videoKeys = Object.values(answers)
    .filter(isVideoRecording)
    .map((d) => d.storageKey);

  if (fileKeys.length === 0 && videoKeys.length === 0) return answers;

  try {
    const [documentUrls, videoUrls] = await Promise.all([
      generateDocumentDownloadPresignedUrls(fileKeys),
      generateVideoDownloadPresignedUrls(videoKeys)
    ]);
    return Object.fromEntries(
      Object.entries(answers).map(([key, data]) => {
        if (isFileUpload(data)) {
          const url = documentUrls[data.fileKey];
          return url ? [key, { ...data, fileUrl: url }] : [key, data];
        }

        if (!isVideoRecording(data)) return [key, data];
        const url = videoUrls[data.storageKey];
        return url ? [key, { ...data, playbackUrl: url }] : [key, data];
      })
    );
  } catch (error) {
    console.error('enrichFileUploadAnswersObject error:', error);
    return answers;
  }
}

async function createExerciseAnswerAssetUsages(
  courseOrganizationId: string,
  courseId: string,
  exerciseId: string,
  groupMemberId: string,
  answers: TQuestionAnswer[],
  dbClient: DbOrTxClient
): Promise<void> {
  const assetAnswers = answers.filter(
    (answer) => isVideoRecording(answer.answerData) || isFileUpload(answer.answerData)
  );
  if (assetAnswers.length === 0) return;

  for (const answer of assetAnswers) {
    if (isFileUpload(answer.answerData)) {
      const asset = await lockAssetById(answer.answerData.assetId, courseOrganizationId, dbClient);
      if (
        !asset ||
        asset.status !== 'active' ||
        asset.kind !== 'document' ||
        asset.storageKey !== answer.answerData.fileKey ||
        asset.mimeType !== answer.answerData.mimeType ||
        asset.byteSize !== answer.answerData.size ||
        // Graders see answerData.fileName; pin it to the locked asset title so
        // the displayed name can never be spoofed in the hand-crafted payload.
        asset.title !== answer.answerData.fileName ||
        !hasExerciseAnswerAssetOwnership(asset.metadata, {
          source: 'exercise_file_upload',
          courseId,
          exerciseId,
          questionId: answer.questionId,
          groupMemberId
        })
      ) {
        throw new AppError('File upload asset is invalid', ErrorCodes.VALIDATION_ERROR, 400);
      }

      await createAssetUsage(
        {
          organizationId: asset.organizationId,
          assetId: answer.answerData.assetId,
          targetType: 'submission_answer',
          targetId: String(answer.id),
          slotType: 'file_upload_answer',
          slotKey: String(answer.questionId),
          createdByProfileId: null
        },
        dbClient
      );
      continue;
    }

    if (!isVideoRecording(answer.answerData)) continue;

    const asset = await lockAssetById(answer.answerData.assetId, courseOrganizationId, dbClient);
    if (
      !asset ||
      asset.status !== 'active' ||
      asset.kind !== 'video' ||
      asset.storageKey !== answer.answerData.storageKey ||
      asset.mimeType !== answer.answerData.mimeType ||
      asset.byteSize !== answer.answerData.size ||
      asset.durationSeconds !== Math.ceil(answer.answerData.durationSeconds) ||
      // Same display-name pin as the file branch: the stored fileName must be
      // the locked asset title, not whatever the payload claims.
      asset.title !== answer.answerData.fileName ||
      !hasExerciseAnswerAssetOwnership(asset.metadata, {
        source: 'exercise_video_recording',
        courseId,
        exerciseId,
        questionId: answer.questionId,
        groupMemberId
      })
    ) {
      throw new AppError('Recording asset is invalid', ErrorCodes.VALIDATION_ERROR, 400);
    }

    await createAssetUsage(
      {
        organizationId: asset.organizationId,
        assetId: answer.answerData.assetId,
        targetType: 'submission_answer',
        targetId: String(answer.id),
        slotType: 'video_recording_answer',
        slotKey: String(answer.questionId),
        createdByProfileId: null
      },
      dbClient
    );
  }
}

/**
 * Gets a submission by ID with question answers
 * @param submissionId Submission ID
 * @returns Submission with question answers
 */
export async function getSubmission(
  courseId: string,
  submissionId: string
): Promise<TSubmission & { answers: TQuestionAnswer[] }> {
  try {
    const submission = await getCourseSubmissionOrThrow(courseId, submissionId);

    let answers = await getQuestionAnswersBySubmissionId(submissionId);
    if (answers.length > 0) {
      answers = await enrichFileUploadAnswersArray(answers);
    }

    return {
      ...submission,
      answers
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to fetch submission',
      ErrorCodes.SUBMISSION_FETCH_FAILED,
      500
    );
  }
}

/** Submission with answers + groupmember (when listing by exercise). Used for route typing. */
type SubmissionWithDetails = Awaited<ReturnType<typeof getSubmissionsByCourseIdWithDetails>>[number];
type AssessmentAnswerProjection = {
  assessmentDefinition?: AssessmentDeliveryDefinition;
  assessmentFeedback?: ReleasedAssessmentFeedback[];
};
type SubmissionAnswerWithAssessmentDefinition = NonNullable<SubmissionWithDetails['answers']>[number] &
  AssessmentAnswerProjection;
type SubmissionWithAssessmentDefinitions = Omit<SubmissionWithDetails, 'answers'> & {
  answers: SubmissionAnswerWithAssessmentDefinition[];
};
type AttemptedQuestionRevision = Awaited<ReturnType<typeof getQuestionRevisionsByIds>>[number];

function attachAttemptedAssessmentAnswers<TAnswer extends TQuestionAnswer>(
  answers: TAnswer[],
  gradingState: SubmissionGradingState,
  revisionById: ReadonlyMap<string, AttemptedQuestionRevision>
): Array<TAnswer & AssessmentAnswerProjection> {
  return answers.map((answer) => {
    if (answer.answerData?.type !== 'ASSESSMENT_ITEM') return answer;

    const revision = answer.questionRevisionId ? revisionById.get(answer.questionRevisionId) : null;
    if (!revision) {
      throw new AppError('The attempted assessment revision was not found', ErrorCodes.INTERNAL_ERROR, 500);
    }

    const parsedDefinition = parseAssessmentItemDefinition(revision.definition);
    if (!parsedDefinition.success) {
      throw new AppError('The attempted assessment revision is invalid', ErrorCodes.INTERNAL_ERROR, 500);
    }

    const parsedResponse = assessmentResponseEnvelopeSchema.safeParse(answer.answerData.response);
    const responseValidation = validateAssessmentResponseEnvelope(parsedDefinition.data, answer.answerData.response);
    if (!parsedResponse.success || !responseValidation.success) {
      throw new AppError('The attempted assessment response is invalid', ErrorCodes.INTERNAL_ERROR, 500);
    }

    return {
      ...answer,
      assessmentDefinition: toAssessmentDeliveryDefinition(parsedDefinition.data),
      assessmentFeedback: resolveReleasedAssessmentFeedback(
        parsedDefinition.data,
        parsedResponse.data,
        gradingState === 'completed' ? 'after_grading' : 'after_submit'
      )
    };
  });
}

/**
 * Attaches a delivery-safe definition to canonical answers using the exact
 * revision materialized at submission time. Historical review must never
 * substitute a current question definition because authors can edit it later.
 */
function attachAttemptedAssessmentDefinitions(
  submission: SubmissionWithDetails,
  revisionById: ReadonlyMap<string, AttemptedQuestionRevision>
): SubmissionWithAssessmentDefinitions {
  const answers = submission.answers ?? [];
  const canonicalAnswers = answers.filter((answer) => answer.answerData?.type === 'ASSESSMENT_ITEM');
  if (canonicalAnswers.length === 0) {
    return { ...submission, answers };
  }

  const revisionIds = canonicalAnswers.map((answer) => answer.questionRevisionId).filter((id): id is string => !!id);
  if (revisionIds.length !== canonicalAnswers.length) {
    throw new AppError(
      'A canonical assessment answer is missing its attempted revision',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }

  return {
    ...submission,
    answers: attachAttemptedAssessmentAnswers(answers, resolveSubmissionGradingState(submission), revisionById)
  };
}

/**
 * Lists submissions for a course filtered by exercise (with answers, groupmember, enriched file URLs)
 * @param courseId Course ID
 * @param exerciseId Exercise ID (required)
 * @param submittedBy Optional group member ID filter
 */
export async function listSubmissionsByExercise(
  courseId: string,
  exerciseId: string,
  submittedBy?: string
): Promise<SubmissionWithAssessmentDefinitions[]> {
  try {
    const submissions = await getSubmissionsByCourseIdWithDetails(courseId, exerciseId, submittedBy);
    const enriched = await Promise.all(
      submissions.map(async (s) =>
        s.answers?.length ? { ...s, answers: await enrichFileUploadAnswersArray(s.answers) } : s
      )
    );
    const canonicalAnswers = enriched.flatMap((submission) =>
      (submission.answers ?? []).filter((answer) => answer.answerData?.type === 'ASSESSMENT_ITEM')
    );
    const canonicalRevisionIds = canonicalAnswers
      .map((answer) => answer.questionRevisionId)
      .filter((revisionId): revisionId is string => !!revisionId);
    if (canonicalRevisionIds.length !== canonicalAnswers.length) {
      throw new AppError(
        'A canonical assessment answer is missing its attempted revision',
        ErrorCodes.INTERNAL_ERROR,
        500
      );
    }

    const uniqueRevisionIds = [...new Set(canonicalRevisionIds)];
    const revisions = uniqueRevisionIds.length > 0 ? await getQuestionRevisionsByIds(uniqueRevisionIds) : [];
    const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
    const withAttemptedDefinitions = enriched.map((submission) =>
      attachAttemptedAssessmentDefinitions(submission, revisionById)
    );
    withAttemptedDefinitions.sort(
      (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
    );
    return withAttemptedDefinitions;
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list submissions by exercise',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export type ExerciseSubmissionsOverview = {
  mySubmission: Awaited<ReturnType<typeof listSubmissionsByExercise>>;
  allSubmissions: Awaited<ReturnType<typeof listSubmissionsByExercise>>;
};

/**
 * Returns submission overview for an exercise based on user role.
 * - Students: mySubmission = their submission(s), allSubmissions = []
 * - Instructors: mySubmission = [], allSubmissions = all submissions in exercise
 */
export async function listExerciseSubmissionsOverview(
  courseId: string,
  exerciseId: string,
  profileId: string
): Promise<ExerciseSubmissionsOverview> {
  try {
    const [groupMemberId, isInstructor] = await Promise.all([
      getGroupMemberIdByCourseAndProfile(courseId, profileId),
      isCourseTeamMemberOrOrgAdmin(courseId, profileId)
    ]);

    const mySubmission = groupMemberId ? await listSubmissionsByExercise(courseId, exerciseId, groupMemberId) : [];

    if (!isInstructor) {
      return { mySubmission, allSubmissions: [] };
    }

    const allSubmissions = await listSubmissionsByExercise(courseId, exerciseId);

    return { mySubmission, allSubmissions };
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list exercise submissions overview',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Lists submissions for grading with pre-processed data
 * @param courseId Course ID
 * @returns Processed submissions organized by status sections
 */
export async function listSubmissionsForGrading(courseId: string) {
  try {
    const rawSubmissions = await getSubmissionsForGrading(courseId);

    type GradingSubmission = (typeof rawSubmissions)[number];
    type GradingAnswer = GradingSubmission['answers'][number];
    type GradingQuestion = GradingSubmission['exercise']['questions'][number];
    type GradingOption = GradingQuestion['options'][number];
    type GradingStudent = NonNullable<GradingSubmission['groupmember']>['profile'];

    const allCanonicalAnswers = rawSubmissions.flatMap((submission) =>
      (submission.answers || []).filter((answer) => answer.answerData?.type === 'ASSESSMENT_ITEM')
    );
    const allCanonicalRevisionIds = allCanonicalAnswers
      .map((answer) => answer.questionRevisionId)
      .filter((revisionId): revisionId is string => !!revisionId);
    if (allCanonicalRevisionIds.length !== allCanonicalAnswers.length) {
      throw new AppError(
        'A canonical assessment answer is missing its attempted revision',
        ErrorCodes.INTERNAL_ERROR,
        500
      );
    }

    const uniqueCanonicalRevisionIds = [...new Set(allCanonicalRevisionIds)];
    const canonicalRevisions =
      uniqueCanonicalRevisionIds.length > 0 ? await getQuestionRevisionsByIds(uniqueCanonicalRevisionIds) : [];
    const canonicalRevisionById = new Map(canonicalRevisions.map((revision) => [revision.id, revision]));

    type SubmissionItem = {
      id: string;
      statusId: number;
      gradingState: SubmissionGradingState;
      overallStatus: SubmissionOverallStatus;
      isEarly: boolean;
      feedback: string | null;
      submittedAt: string;
      exercise: {
        id: string;
        title: string;
      };
      answers: GradingAnswer[];
      student: GradingStudent;
      lesson: {
        id: string;
        title: string;
      } | null;
    };

    type SubmissionIdDetails = {
      id: string;
      statusId: number;
      gradingState: SubmissionGradingState;
      overallStatus: SubmissionOverallStatus;
      feedback: string | null;
      isEarly: boolean;
      title: string;
      student: GradingStudent;
      questions: Array<
        Pick<GradingQuestion, 'id' | 'title' | 'name' | 'order' | 'points' | 'questionTypeId'> & {
          settings: unknown;
          options: Array<
            Pick<GradingOption, 'id' | 'label' | 'value' | 'isCorrect'> & {
              settings: unknown;
            }
          >;
        }
      >;
      canonicalQuestions: Array<{
        id: number;
        title: string;
        order: number | null;
        exerciseSectionId: string | null;
        definition: AssessmentDeliveryDefinition;
      }>;
      answers: Record<string, AnswerData>;
      questionAnswers: Array<Pick<GradingAnswer, 'questionId' | 'answerData'>>;
      questionAnswerByPoint: Record<number, number>;
    };

    const sections: Array<{ id: number; title: string; value: number; items: SubmissionItem[] }> = [
      { id: 1, title: LEGACY_BOARD_STATUS_LABELS[1], value: 0, items: [] },
      { id: 2, title: LEGACY_BOARD_STATUS_LABELS[2], value: 0, items: [] },
      { id: 3, title: LEGACY_BOARD_STATUS_LABELS[3], value: 0, items: [] }
    ];

    const submissionIdData: Record<string, SubmissionIdDetails> = {};

    // Process each submission
    for (const submission of rawSubmissions) {
      const gradingState = resolveSubmissionGradingState(submission);
      const statusId = projectLegacyStatusId(gradingState);
      const storedOverallStatus = typeof submission.overallStatus === 'string' ? submission.overallStatus : '';
      const fallbackOverallStatus = resolveOverallStatusFromQuestionTypeIds(
        (submission.exercise.questions || [])
          .map((question) => Number(question.questionTypeId))
          .filter((questionTypeId) => Number.isFinite(questionTypeId))
      );
      const overallStatus: SubmissionOverallStatus =
        storedOverallStatus === 'auto_graded' ||
        storedOverallStatus === 'manual_required' ||
        storedOverallStatus === 'hybrid'
          ? (storedOverallStatus as SubmissionOverallStatus)
          : fallbackOverallStatus;
      const isEarly = submission.exercise.dueBy
        ? new Date(submission.createdAt!).getTime() <= new Date(submission.exercise.dueBy).getTime()
        : true;

      const submittedAt = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'medium'
      }).format(new Date(submission.createdAt!));

      const questionKeyById: { [id: number]: string } = {};
      const questionTypeById: { [id: number]: number } = {};
      for (const question of submission.exercise.questions || []) {
        questionKeyById[question.id] = question.name ? String(question.name) : String(question.id);
        questionTypeById[question.id] = question.questionTypeId;
      }

      const formattedAnswers: { [questionKey: string]: AnswerData } = {};
      const questionAnswerByPoint: { [questionId: number]: number } = {};

      for (const answer of submission.answers || []) {
        const questionKey = questionKeyById[answer.questionId];
        if (
          questionKey &&
          answer.answerData &&
          typeof answer.answerData === 'object' &&
          answer.answerData !== null &&
          'type' in answer.answerData
        ) {
          formattedAnswers[questionKey] = answer.answerData as AnswerData;
        }
        questionAnswerByPoint[answer.questionId] = Number(answer.score ?? answer.point ?? 0);
      }

      const enrichedFormattedAnswers = await enrichFileUploadAnswersObject(formattedAnswers);
      const canonicalAnswers = (submission.answers || []).filter(
        (answer) => answer.answerData?.type === 'ASSESSMENT_ITEM'
      );
      const exerciseQuestionById = new Map(
        (submission.exercise.questions || []).map((question) => [question.id, question])
      );
      const canonicalQuestions = canonicalAnswers.map((answer) => {
        const revision = canonicalRevisionById.get(answer.questionRevisionId!);
        if (!revision) {
          throw new AppError('The attempted assessment revision was not found', ErrorCodes.INTERNAL_ERROR, 500);
        }
        const question = exerciseQuestionById.get(answer.questionId);
        if (!question) {
          throw new AppError('The attempted assessment question was not found', ErrorCodes.INTERNAL_ERROR, 500);
        }

        const parsedDefinition = parseAssessmentItemDefinition(revision.definition);
        if (!parsedDefinition.success) {
          throw new AppError('The attempted assessment revision is invalid', ErrorCodes.INTERNAL_ERROR, 500);
        }

        return {
          id: answer.questionId,
          title: typeof answer.attemptedQuestionTitle === 'string' ? answer.attemptedQuestionTitle : question.title,
          order:
            typeof answer.attemptedQuestionTitle === 'string'
              ? (answer.attemptedQuestionOrder ?? null)
              : (question.order ?? null),
          exerciseSectionId:
            typeof answer.attemptedQuestionTitle === 'string'
              ? (answer.attemptedExerciseSectionId ?? null)
              : (question.exerciseSectionId ?? null),
          definition: toAssessmentDeliveryDefinition(parsedDefinition.data)
        };
      });
      const legacyQuestions = (submission.exercise.questions || []).filter(
        (question) => question.questionTypeId !== QUESTION_TYPE_IDS.ASSESSMENT_ITEM
      );

      // Create submission item for sections
      const submissionItem = {
        id: submission.id,
        statusId,
        gradingState,
        overallStatus,
        isEarly,
        feedback: submission.feedback,
        submittedAt,
        exercise: {
          id: submission.exercise.id,
          title: submission.exercise.title
        },
        answers: submission.answers || [],
        student: submission.groupmember?.profile || null,
        lesson: submission.lesson
          ? {
              id: submission.lesson.id,
              title: submission.lesson.title
            }
          : null
      };

      // Add to appropriate section
      const sectionIndex = statusId - 1;
      if (sectionIndex >= 0 && sectionIndex < sections.length) {
        sections[sectionIndex].items.push(submissionItem);
        sections[sectionIndex].value = sections[sectionIndex].items.length;
      }

      // Create detailed data for modal
      submissionIdData[submission.id] = {
        id: submission.id,
        statusId,
        gradingState,
        overallStatus,
        feedback: submission.feedback,
        isEarly,
        title: submission.exercise.title,
        student: submission.groupmember?.profile || null,
        questions: legacyQuestions.map((q) => ({
          id: q.id,
          title: q.title,
          name: q.name,
          order: q.order,
          points: q.points,
          questionTypeId: q.questionTypeId,
          settings: q.settings ?? {},
          options: (q.options || []).map((opt) => ({
            id: opt.id,
            label: opt.label,
            value: opt.value,
            isCorrect: opt.isCorrect,
            settings: opt.settings ?? {}
          }))
        })),
        canonicalQuestions,
        answers: enrichedFormattedAnswers,
        questionAnswers: (submission.answers || []).map((answer) => ({
          questionId: answer.questionId,
          answerData: answer.answerData
        })),
        questionAnswerByPoint
      };
    }

    return {
      sections,
      submissionIdData
    };
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list submissions for grading',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Creates a new submission with question answers
 * @param courseId Course ID
 * @param exerciseId Exercise ID
 * @param submittedBy Group member ID
 * @param answers Array of question answers
 * @returns Created submission (with `answers` when auto-graded on the server)
 */
export async function createSubmissionService(
  courseId: string,
  exerciseId: string,
  submittedBy: string,
  answers: SubmissionAnswerPayload[],
  idempotencyKey?: string
): Promise<TSubmission & { answers?: TQuestionAnswer[] }> {
  try {
    const totalAnswerCharacters = getExerciseSubmissionPayloadCharacterCount(answers);
    if (totalAnswerCharacters > EXERCISE_SUBMISSION_MAX_TOTAL_ANSWER_CHARACTERS) {
      throw new AppError('Submission answers are too large', ErrorCodes.VALIDATION_ERROR, 400);
    }

    const transactionResult = await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      await lockExerciseAssignmentState(exerciseId, txClient);
      // Active delivery scope: archived questions never enter a new attempt.
      const exerciseWithRelations = await getExerciseWithRelationsOptimized(exerciseId, txClient, {
        questionScope: 'active'
      });
      const lockedExercise = exerciseWithRelations.exercise;
      if (lockedExercise.courseId !== courseId) {
        throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
      }

      const exerciseAccess = await resolveGroupMemberExerciseAccess(courseId, exerciseId, submittedBy, txClient);
      if (!exerciseAccess.hasAccess) {
        throw new AppError('Exercise is not assigned to this student', ErrorCodes.EXERCISE_NOT_ASSIGNED, 403);
      }

      if (idempotencyKey) {
        const existingSubmission = await getSubmissionByIdempotencyKey(
          exerciseId,
          submittedBy,
          idempotencyKey,
          txClient
        );
        if (existingSubmission) {
          const existingAnswers = await getQuestionAnswersBySubmissionId(existingSubmission.id, txClient);
          return {
            submission: existingSubmission,
            answersWithPoints: existingAnswers,
            includeAnswersInResponse: existingSubmission.overallStatus === 'auto_graded',
            isReplay: true
          };
        }
      }

      if (!lockedExercise.allowMultipleAttempts) {
        const alreadySubmitted = await hasSubmission(exerciseId, submittedBy, txClient);
        if (alreadySubmitted) {
          throw new AppError('This exercise allows only one submission', ErrorCodes.VALIDATION_ERROR, 400);
        }
      }

      const activeQuestions = exerciseWithRelations.questions.filter(
        (question): question is typeof question & { id: number } => question.id != null
      );
      // An exercise whose every question is archived has nothing to attempt:
      // reject before any materialization or write so no empty completed
      // submission can ever be recorded.
      if (activeQuestions.length === 0) {
        throw new AppError('Exercise has no active questions to attempt', ErrorCodes.CONFLICT, 409);
      }

      const questionsById = new Map(activeQuestions.map((question) => [question.id, question]));
      const submittedQuestionIds = new Set<number>();
      for (const answer of answers) {
        if (submittedQuestionIds.has(answer.questionId)) {
          throw new AppError(
            `Question ${answer.questionId} was answered more than once`,
            ErrorCodes.VALIDATION_ERROR,
            400
          );
        }
        submittedQuestionIds.add(answer.questionId);

        const question = questionsById.get(answer.questionId);
        if (!question) {
          throw new AppError(
            `Question ${answer.questionId} does not belong to this exercise`,
            ErrorCodes.VALIDATION_ERROR,
            400
          );
        }
        if (question.questionTypeId === QUESTION_TYPE_IDS.ASSESSMENT_ITEM) {
          if (
            answer.questionRevisionId === undefined ||
            answer.optionId !== undefined ||
            answer.answer !== undefined ||
            answer.response === undefined
          ) {
            throw new AppError(
              `Question ${answer.questionId} requires a canonical assessment response and delivered revision`,
              ErrorCodes.VALIDATION_ERROR,
              400
            );
          }
        } else if (answer.questionRevisionId !== undefined) {
          throw new AppError(
            `Question ${answer.questionId} does not accept a question revision field`,
            ErrorCodes.VALIDATION_ERROR,
            400
          );
        }
      }

      const legacyQuestions = activeQuestions.filter(
        (question) => question.questionTypeId !== QUESTION_TYPE_IDS.ASSESSMENT_ITEM
      );
      const legacyAnswers = answers.filter(
        (answer) => questionsById.get(answer.questionId)?.questionTypeId !== QUESTION_TYPE_IDS.ASSESSMENT_ITEM
      );
      prepareSubmissionAnswers(
        legacyQuestions.map((question) => ({
          id: question.id,
          title: question.title,
          questionTypeId: question.questionTypeId,
          points: question.points,
          settings: question.settings,
          options: question.options
        })),
        legacyAnswers
      );

      for (const question of activeQuestions) {
        if (question.questionTypeId !== QUESTION_TYPE_IDS.ASSESSMENT_ITEM || submittedQuestionIds.has(question.id)) {
          continue;
        }

        throw new AppError(`Question ${question.id} requires an answer`, ErrorCodes.VALIDATION_ERROR, 400);
      }

      // Materialize or reuse the immutable revision of every active question so
      // each new answer links the exact attempted definition. Sequential on
      // purpose: one transaction client cannot run parallel commands.
      const revisionIdByQuestionId = new Map<number, string>();
      const submittedAnswerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));
      for (const question of activeQuestions) {
        if (question.questionTypeId === QUESTION_TYPE_IDS.ASSESSMENT_ITEM) {
          const currentRevision = await getCurrentQuestionRevision(question.id, txClient);
          if (!currentRevision) {
            throw new AppError(
              `Assessment question ${question.id} has no published revision`,
              ErrorCodes.CONFLICT,
              409
            );
          }

          const deliveredRevisionId = submittedAnswerByQuestionId.get(question.id)?.questionRevisionId;
          if (!deliveredRevisionId) {
            throw new AppError(
              `Assessment question ${question.id} is missing its delivered revision`,
              ErrorCodes.VALIDATION_ERROR,
              400
            );
          }
          if (currentRevision.id !== deliveredRevisionId) {
            throw new AppError(
              `Assessment question ${question.id} changed after it was delivered; reload the exercise before submitting`,
              ErrorCodes.CONFLICT,
              409
            );
          }

          revisionIdByQuestionId.set(question.id, deliveredRevisionId);
          continue;
        }

        const revision = await materializeLegacyQuestionRevision(question.id, txClient);
        revisionIdByQuestionId.set(question.id, revision.id);
      }

      const definitionByQuestionId = await loadAttemptedDefinitions(revisionIdByQuestionId, txClient);
      const preparedAnswers = prepareSubmissionAnswers(
        activeQuestions.map((question) => ({
          id: question.id,
          title: question.title,
          questionTypeId: question.questionTypeId,
          points: question.points,
          settings: question.settings,
          options: question.options
        })),
        answers,
        definitionByQuestionId
      );
      const gradingModeByQuestionId = new Map<number, AssessmentGradingMode>(
        activeQuestions.map((question) => [
          question.id,
          resolveQuestionGradingMode(question.questionTypeId, definitionByQuestionId.get(question.id))
        ])
      );
      const overallStatus = combineGradingModes([...gradingModeByQuestionId.values()]);
      const gradingState: SubmissionGradingState = overallStatus === 'auto_graded' ? 'completed' : 'awaiting_manual';
      const submissionData: TNewSubmission = {
        courseId,
        exerciseId,
        submittedBy,
        statusId: projectLegacyStatusId(gradingState),
        gradingState,
        overallStatus,
        total: 0,
        score: 0,
        idempotencyKey
      };
      let submission = await createSubmission(submissionData, txClient);
      const attemptedRevisionIdOrThrow = (questionId: number): string => {
        const revisionId = revisionIdByQuestionId.get(questionId);
        if (!revisionId) {
          throw new AppError(
            `Question "${questionId}" has no materialized revision for this attempt`,
            ErrorCodes.INTERNAL_ERROR,
            500
          );
        }

        return revisionId;
      };
      const answerRows: TNewQuestionAnswer[] = preparedAnswers.answers.map((answer) => {
        const attemptedQuestion = questionsById.get(answer.questionId);
        if (!attemptedQuestion) {
          throw new AppError(
            `Question "${answer.questionId}" disappeared before its attempt metadata was captured`,
            ErrorCodes.INTERNAL_ERROR,
            500
          );
        }

        return {
          submissionId: submission.id,
          questionId: answer.questionId,
          groupMemberId: submittedBy,
          answerData: answer.answerData,
          questionRevisionId: attemptedRevisionIdOrThrow(answer.questionId),
          attemptedQuestionTitle: attemptedQuestion.title,
          attemptedQuestionOrder: attemptedQuestion.order ?? null,
          attemptedExerciseSectionId: attemptedQuestion.exerciseSectionId ?? null
        };
      });

      // The attempt covers the whole active set: unanswered (optional) questions
      // get an explicit empty row so the stored attempted set and its revision
      // links stay complete for historical grading and review.
      for (const question of activeQuestions) {
        if (preparedAnswers.answerByQuestionId.has(question.id)) continue;

        answerRows.push({
          submissionId: submission.id,
          questionId: question.id,
          groupMemberId: submittedBy,
          answerData: null,
          questionRevisionId: attemptedRevisionIdOrThrow(question.id),
          attemptedQuestionTitle: question.title,
          attemptedQuestionOrder: question.order ?? null,
          attemptedExerciseSectionId: question.exerciseSectionId ?? null
        });
      }

      const hasAutoGradableQuestions = activeQuestions.some(
        (question) => gradingModeByQuestionId.get(question.id) !== 'manual'
      );

      const insertedAnswers = await insertQuestionAnswersBatch(answerRows, txClient);
      const hasManagedAssetAnswer = insertedAnswers.some(
        (answer) => isVideoRecording(answer.answerData) || isFileUpload(answer.answerData)
      );
      if (hasManagedAssetAnswer) {
        const courseOrganizationId = await getCourseOrganizationId(courseId, txClient);
        if (!courseOrganizationId) {
          throw new AppError('Course organization not found', ErrorCodes.INTERNAL_ERROR, 500);
        }

        await createExerciseAnswerAssetUsages(
          courseOrganizationId,
          courseId,
          exerciseId,
          submittedBy,
          insertedAnswers,
          txClient
        );
      }

      let answersWithPoints = insertedAnswers;
      if (hasAutoGradableQuestions) {
        const scoreableLegacyQuestions = activeQuestions
          .filter((question) => question.questionTypeId !== QUESTION_TYPE_IDS.ASSESSMENT_ITEM)
          .map((question) => ({
            id: question.id,
            title: question.title,
            questionTypeId: question.questionTypeId,
            points: question.points != null ? Number(question.points) : 0,
            settings:
              question.settings && typeof question.settings === 'object' && !Array.isArray(question.settings)
                ? (question.settings as Record<string, unknown>)
                : {},
            options: question.options ?? []
          }));
        const legacyScoreResult: ScoreSubmissionResult = scoreSubmissionAnswers(
          scoreableLegacyQuestions,
          preparedAnswers.answerByQuestionId
        );
        const canonicalScores = activeQuestions.flatMap((question) => {
          if (question.questionTypeId !== QUESTION_TYPE_IDS.ASSESSMENT_ITEM) return [];
          if (gradingModeByQuestionId.get(question.id) === 'manual') {
            return [{ questionId: question.id, points: 0 }];
          }

          const definition = definitionByQuestionId.get(question.id);
          const answer = preparedAnswers.answerByQuestionId.get(question.id);
          if (!definition || answer?.type !== 'ASSESSMENT_ITEM') {
            return [{ questionId: question.id, points: 0 }];
          }

          const validation = validateAssessmentResponseEnvelope(definition, answer.response);
          if (!validation.success) {
            throw new AppError(
              `Stored assessment response for question ${question.id} is invalid`,
              ErrorCodes.INTERNAL_ERROR,
              500
            );
          }

          return [
            { questionId: question.id, points: scoreAssessmentVerticalSlice(definition, validation.data).autoScore }
          ];
        });
        const scores = [...legacyScoreResult.scores, ...canonicalScores];
        const total = scores.reduce((sum, score) => sum + score.points, 0);
        const gradedSubmission = await updateSubmissionGrades(
          courseId,
          submission.id,
          {
            answers: scores.map((score) => ({ questionId: score.questionId, points: score.points })),
            total,
            statusId: projectLegacyStatusId(gradingState),
            gradingState
          },
          txClient
        );
        if (!gradedSubmission) {
          throw new AppError('Failed to grade submission', ErrorCodes.INTERNAL_ERROR, 500);
        }

        submission = gradedSubmission;
        const pointByQuestionId = new Map(scores.map((score) => [score.questionId, score.points]));
        answersWithPoints = insertedAnswers.map((answer) => ({
          ...answer,
          score: pointByQuestionId.get(answer.questionId) ?? answer.score,
          point: Math.round(pointByQuestionId.get(answer.questionId) ?? answer.score ?? 0)
        }));
      }

      return {
        submission,
        answersWithPoints,
        includeAnswersInResponse: overallStatus === 'auto_graded',
        isReplay: false
      };
    });

    const { submission, answersWithPoints, includeAnswersInResponse, isReplay } = transactionResult;
    if (!isReplay) {
      void emitSubmissionWebhook('course.submission.created', submission).catch((error) => {
        console.error('Failed to emit submission created webhook:', error);
      });
      void sendExerciseSubmissionUpdateEmail(courseId, exerciseId, submittedBy, submission.id).catch((emailError) => {
        console.error('Failed to send exercise submission update email:', emailError);
      });

      void syncComplianceProgressFromSubmission(courseId, submittedBy).catch((error) => {
        console.error('Failed to sync compliance after exercise submission:', error);
      });
      void triggerCertificationIfExerciseComplete(courseId, exerciseId, submittedBy).catch((error) => {
        console.error('Failed to evaluate certification after exercise submission:', error);
      });
    }

    if (includeAnswersInResponse) {
      const enrichedAnswers =
        answersWithPoints.length > 0 ? await enrichFileUploadAnswersArray(answersWithPoints) : answersWithPoints;
      return { ...submission, answers: enrichedAnswers };
    }

    return submission;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create submission',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Updates a submission
 * @param submissionId Submission ID
 * @param data Partial submission update data
 * @returns Updated submission
 */
export async function updateSubmissionService(
  courseId: string,
  submissionId: string,
  data: TSubmissionUpdate
): Promise<TSubmission> {
  try {
    const transactionResult = await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      const submission = await lockCourseSubmissionOrThrow(courseId, submissionId, txClient);
      const currentGradingState = resolveSubmissionGradingState(submission);
      const requestedGradingState = resolveRequestedGradingState(data);
      if (requestedGradingState === 'completed' && currentGradingState !== 'completed') {
        throw new AppError('Complete submissions through the grading endpoint', ErrorCodes.VALIDATION_ERROR, 400);
      }
      if (requestedGradingState && !isAllowedGradingTransition(currentGradingState, requestedGradingState)) {
        throw new AppError('Invalid submission workflow transition', ErrorCodes.VALIDATION_ERROR, 400);
      }

      const previousLegacyStatusId = projectLegacyStatusId(currentGradingState);
      const updatePayload: Partial<TSubmission> = { ...data };
      if (requestedGradingState) {
        updatePayload.gradingState = requestedGradingState;
        updatePayload.statusId = projectLegacyStatusId(requestedGradingState);
      }

      const nextLegacyStatusId = Number(updatePayload.statusId ?? previousLegacyStatusId);
      const statusChanged = nextLegacyStatusId !== previousLegacyStatusId;
      const updated = await updateSubmission(courseId, submissionId, updatePayload, txClient);
      if (!updated) {
        throw new AppError('Failed to update submission', ErrorCodes.INTERNAL_ERROR, 500);
      }

      return { nextLegacyStatusId, statusChanged, updated };
    });
    const { nextLegacyStatusId, statusChanged, updated } = transactionResult;

    if (statusChanged) {
      void sendSubmissionUpdateEmail(submissionId, nextLegacyStatusId).catch((emailError) => {
        console.error('Failed to send submission update email:', emailError);
      });
      void emitSubmissionWebhook('course.submission.status_changed', updated).catch((error) => {
        console.error('Failed to emit submission status changed webhook:', error);
      });
    }

    if (updated.gradingState === 'completed' && updated.courseId && updated.submittedBy) {
      void syncComplianceProgressFromSubmission(updated.courseId, updated.submittedBy).catch((error) => {
        console.error('Failed to sync compliance after submission update:', error);
      });
    }

    return updated;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update submission',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Updates a question answer in a submission
 * @param submissionId Submission ID
 * @param questionId Question ID
 * @param data Question answer update data
 * @returns Updated question answer
 */
export async function updateSubmissionAnswer(
  courseId: string,
  submissionId: string,
  questionId: number,
  data: TSubmissionAnswerUpdate
): Promise<TQuestionAnswer | null> {
  try {
    const points = data.points;
    if (points === undefined) return null;

    return await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      const submission = await lockCourseSubmissionOrThrow(courseId, submissionId, txClient);
      const gradingState = resolveSubmissionGradingState(submission);
      if (gradingState !== 'processing' && gradingState !== 'awaiting_manual') {
        throw new AppError('Submission is not open for manual grading', ErrorCodes.CONFLICT, 409);
      }

      await lockExerciseAssignmentState(submission.exerciseId, txClient);
      const exerciseWithRelations = await getExerciseWithRelationsOptimized(submission.exerciseId, txClient);
      if (exerciseWithRelations.exercise.courseId !== courseId) {
        throw new AppError('Submission exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
      }

      // The attempted set (archived questions included) is the grading truth:
      // capability and maximum come from the exact attempted revision, never
      // from the live question row.
      const attemptedQuestions = await resolveAttemptedQuestionSet(submissionId, txClient);
      const attemptedQuestion = attemptedQuestions.find((entry) => entry.questionId === questionId);
      if (!attemptedQuestion || !attemptedQuestion.capabilities.manualGradingRequired) {
        throw new AppError('Question is not available for manual grading', ErrorCodes.VALIDATION_ERROR, 400);
      }

      const storedAnswers = await getQuestionAnswersBySubmissionId(submissionId, txClient);
      const preparedGrades = prepareSubmissionGrades({
        questions: attemptedQuestions.map((entry) => ({ id: entry.questionId, points: entry.maxScore })),
        storedAnswers,
        updates: [{ questionId, points }]
      });
      const updatedSubmission = await updateSubmissionGrades(
        courseId,
        submissionId,
        {
          answers: preparedGrades.answers,
          total: preparedGrades.total
        },
        txClient
      );
      if (!updatedSubmission) {
        throw new AppError('Failed to update submission score', ErrorCodes.INTERNAL_ERROR, 500);
      }

      const updatedAnswers = await getQuestionAnswersBySubmissionId(submissionId, txClient);
      const updatedAnswer = updatedAnswers.find((answer) => answer.questionId === questionId);
      if (!updatedAnswer) {
        throw new AppError('Question answer not found', ErrorCodes.SUBMISSION_NOT_FOUND, 404);
      }

      return updatedAnswer;
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update question answer',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Updates all question answer points and submission total/feedback in a single transaction.
 * Submitting grades automatically transitions status to Graded (statusId 3, gradingState completed).
 */
export async function updateSubmissionGradesBatch(
  courseId: string,
  submissionId: string,
  data: TSubmissionGradesUpdate
): Promise<TSubmission> {
  try {
    const transactionResult = await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      const submission = await lockCourseSubmissionOrThrow(courseId, submissionId, txClient);
      await lockExerciseAssignmentState(submission.exerciseId, txClient);
      const exerciseWithRelations = await getExerciseWithRelationsOptimized(submission.exerciseId, txClient);
      if (exerciseWithRelations.exercise.courseId !== courseId) {
        throw new AppError('Submission exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
      }

      const storedAnswers = await getQuestionAnswersBySubmissionId(submissionId, txClient);
      // Grade against the attempted set (archived questions included) so every
      // maximum comes from the exact attempted revision, never live points.
      const attemptedQuestions = await resolveAttemptedQuestionSet(submissionId, txClient);
      const preparedGrades = prepareSubmissionGrades({
        questions: attemptedQuestions.map((entry) => ({ id: entry.questionId, points: entry.maxScore })),
        storedAnswers,
        updates: data.answers,
        expectedTotal: data.total,
        requireAllAnswers: true
      });
      const currentGradingState = resolveSubmissionGradingState(submission);
      const targetGradingState: SubmissionGradingState = 'completed';
      const targetStatusId = projectLegacyStatusId(targetGradingState);
      if (!isAllowedGradingTransition(currentGradingState, targetGradingState)) {
        throw new AppError('Invalid submission workflow transition', ErrorCodes.VALIDATION_ERROR, 400);
      }

      const previousLegacyStatusId = projectLegacyStatusId(currentGradingState);
      const statusChanged = targetStatusId !== previousLegacyStatusId;
      const updated = await updateSubmissionGrades(
        courseId,
        submissionId,
        {
          answers: preparedGrades.answers,
          total: preparedGrades.total,
          feedback: data.feedback,
          statusId: targetStatusId,
          gradingState: targetGradingState
        },
        txClient
      );
      if (!updated) {
        throw new AppError('Failed to update grades', ErrorCodes.INTERNAL_ERROR, 500);
      }

      return { statusChanged, targetStatusId, updated };
    });
    const { statusChanged, targetStatusId, updated } = transactionResult;

    if (statusChanged) {
      void sendSubmissionUpdateEmail(submissionId, targetStatusId).catch((emailError) => {
        console.error('Failed to send submission update email:', emailError);
      });
      void emitSubmissionWebhook('course.submission.status_changed', updated).catch((error) => {
        console.error('Failed to emit submission status changed webhook:', error);
      });
    }

    if (updated.courseId && updated.submittedBy) {
      void syncComplianceProgressFromSubmission(updated.courseId, updated.submittedBy).catch((error) => {
        console.error('Failed to sync compliance after submission grading:', error);
      });
      void triggerCertificationIfExerciseComplete(updated.courseId, updated.exerciseId, updated.submittedBy).catch(
        (error) => {
          console.error('Failed to evaluate certification after submission grading:', error);
        }
      );
    }

    return updated;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update submission grades',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

async function emitSubmissionWebhook(
  eventType: 'course.submission.created' | 'course.submission.status_changed',
  submission: TSubmission
) {
  if (!submission.courseId) return;

  const course = await getCourseWithOrgData(submission.courseId);
  if (!course?.orgId) return;

  await emitWebhookEvent(course.orgId, eventType, {
    courseId: submission.courseId,
    exerciseId: submission.exerciseId,
    gradingState: submission.gradingState,
    statusId: submission.statusId,
    submissionId: submission.id,
    submittedByGroupMemberId: submission.submittedBy
  });
}

/**
 * Deletes a submission
 * @param submissionId Submission ID
 * @returns Deleted submission
 */
export async function deleteSubmissionService(courseId: string, submissionId: string): Promise<TSubmission> {
  try {
    const deleted = await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      await lockCourseSubmissionOrThrow(courseId, submissionId, txClient);
      const answers = await getQuestionAnswersBySubmissionId(submissionId, txClient);

      for (const answer of answers) {
        await deleteAssetUsagesByTarget('submission_answer', String(answer.id), txClient);
      }

      return deleteSubmission(courseId, submissionId, txClient);
    });
    if (!deleted) {
      throw new AppError('Failed to delete submission', ErrorCodes.INTERNAL_ERROR, 500);
    }

    return deleted;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to delete submission',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Sends email notification to student when submission status changes
 */
async function sendSubmissionUpdateEmail(submissionId: string, newStatusId: number) {
  const submission = await getSubmissionById(submissionId);
  if (!submission || !submission.courseId) {
    return;
  }

  const submissionData = await getSubmissionsForGrading(submission.courseId);
  const fullSubmission = submissionData.find((s) => s.id === submissionId);
  if (!fullSubmission || !fullSubmission.groupmember?.profile?.email) {
    return;
  }

  const courseResult = await getCourseById(fullSubmission.courseId || '');
  const course = courseResult[0];
  if (!course) {
    return;
  }

  // Get organization name and URL info
  const orgResult = await getCourseWithOrgData(fullSubmission.courseId || '');

  const orgName = orgResult?.orgName || 'ClassroomHub';

  const baseUrl = getDashboardBaseUrl({
    siteName: orgResult?.orgSiteName,
    customDomain: orgResult?.orgCustomDomain,
    isCustomDomainVerified: orgResult?.orgIsCustomDomainVerified
  });
  const exerciseLink = `${baseUrl}/courses/${fullSubmission.courseId}/exercises/${fullSubmission.exercise.id}`;

  // Calculate total and max points. The numerator sums numeric(12,2) values as
  // floats, so round it back to two decimals before it renders in the email.
  const answers = fullSubmission.answers || [];
  const totalMark = roundToTwoDecimals(
    answers.reduce((sum, answer) => sum + Number(answer.score ?? answer.point ?? 0), 0)
  );
  // The denominator is pinned to the attempted revisions (archived questions
  // included) so later edits or archival cannot drift historical scores; live
  // points remain only for pre-revision submissions without stored answers.
  const attemptedQuestions = await resolveAttemptedQuestionSet(submissionId);
  const maxMark =
    attemptedQuestions.length > 0
      ? roundToTwoDecimals(attemptedQuestions.reduce((sum, entry) => sum + entry.maxScore, 0))
      : (fullSubmission.exercise.questions || []).reduce((sum, question) => sum + Number(question.points ?? 0), 0);

  const isGraded = newStatusId === 3;
  const score = isGraded ? `${totalMark}/${maxMark}` : undefined;
  // The in-app notification still names the status; the email resolves its own copy from statusId.
  const statusText = LEGACY_BOARD_STATUS_LABELS[newStatusId] || 'Updated';

  try {
    if (orgResult?.orgId) {
      await createNotification({
        profileId: fullSubmission.groupmember.profile.id,
        organizationId: orgResult.orgId,
        courseId: fullSubmission.courseId,
        type: 'SUBMISSION_GRADED',
        title: `${fullSubmission.exercise.title} was graded`,
        body: score ? `${statusText}: ${score}` : statusText,
        metadata: {
          exerciseId: fullSubmission.exercise.id,
          link: `/courses/${fullSubmission.courseId}/exercises/${fullSubmission.exercise.id}`,
          submissionId
        }
      });
    }

    await enqueueTransactionalEmail('submissionGraded', {
      to: fullSubmission.groupmember.profile.email,
      fields: {
        orgName,
        studentName: fullSubmission.groupmember.profile.fullname || 'Student',
        exerciseTitle: fullSubmission.exercise.title,
        courseName: course.title,
        statusId: newStatusId,
        exerciseLink,
        score,
        lessonTitle: fullSubmission.lesson?.title,
        branding: buildEmailBranding({
          name: orgResult?.orgName,
          avatarUrl: orgResult?.orgAvatarUrl,
          theme: orgResult?.orgTheme
        })
      },
      from: buildEmailFromName(`${orgName} (via ClassroomHub)`),
      idempotencyKey: `submission-update:${submissionId}:${newStatusId}`,
      preference: {
        organizationId: orgResult?.orgId,
        recipientProfileId: fullSubmission.groupmember.profile.id
      }
    });
  } catch (error) {
    console.error('Failed to enqueue submission graded email:', error);
  }
}

/**
 * Sends email notification to teachers when a student submits an exercise
 */
async function sendExerciseSubmissionUpdateEmail(
  courseId: string,
  exerciseId: string,
  submittedBy: string,
  submissionId: string
) {
  // Get course and exercise data
  const course = await getCourseById(courseId);
  if (!course) {
    return;
  }

  const exercise = await getExerciseById(exerciseId);

  if (!exercise) {
    return;
  }

  // Get student info
  const student = await getProfileByGroupMemberId(submittedBy);

  if (!student) {
    return;
  }

  // Get tutors (ADMIN or TUTOR role) from the course's group
  const tutorsResult = await getCourseTeachers({ courseId });

  if (tutorsResult.length === 0) {
    return;
  }

  // Get organization name and URL info
  const orgResult = await getCourseWithOrgData(courseId);

  const orgName = orgResult?.orgName || 'ClassroomHub';

  const baseUrl = getDashboardBaseUrl({
    siteName: orgResult?.orgSiteName,
    customDomain: orgResult?.orgCustomDomain,
    isCustomDomainVerified: orgResult?.orgIsCustomDomainVerified
  });
  const exerciseLink = `${baseUrl}/courses/${courseId}/exercises/${exerciseId}`;
  const submissionLink = `${baseUrl}/courses/${courseId}/submissions`;

  const studentName = student.fullname || student.username || 'A student';

  const tutorEmails = tutorsResult.map((tutor) => tutor.email).filter((email): email is string => Boolean(email));
  if (tutorEmails.length === 0) return;

  try {
    await enqueueTransactionalEmail('submissionReceived', {
      to: tutorEmails,
      fields: {
        orgName,
        studentName,
        exerciseTitle: exercise.title,
        exerciseLink,
        submissionLink,
        branding: buildEmailBranding({
          name: orgResult?.orgName,
          avatarUrl: orgResult?.orgAvatarUrl,
          theme: orgResult?.orgTheme
        })
      },
      from: buildEmailFromName(`${orgName} (via ClassroomHub)`),
      idempotencyKey: `exercise-submitted:${courseId}:${exerciseId}:${submittedBy}:${submissionId}`,
      preference: { organizationId: orgResult?.orgId }
    });
  } catch (error) {
    console.error('Failed to enqueue submission received email:', error);
  }
}
