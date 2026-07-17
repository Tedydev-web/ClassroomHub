import * as z from 'zod';

export const ZSubmissionGradingState = z.enum(['queued', 'processing', 'awaiting_manual', 'completed', 'failed']);
export type TSubmissionGradingState = z.infer<typeof ZSubmissionGradingState>;

export const ZSubmissionOverallStatus = z.enum(['auto_graded', 'manual_required', 'hybrid']);
export type TSubmissionOverallStatus = z.infer<typeof ZSubmissionOverallStatus>;

const SCORE_SCALE = 100;
const SCORE_PRECISION_TOLERANCE = 1e-8;

const ZSubmissionScore = z
  .number()
  .finite()
  .min(0)
  .refine(
    (score) => Math.abs(score * SCORE_SCALE - Math.round(score * SCORE_SCALE)) <= SCORE_PRECISION_TOLERANCE,
    'Score must have at most two decimal places'
  );

export const ZSubmissionGetParam = z.object({
  submissionId: z.string().min(1)
});
export type TSubmissionGetParam = z.infer<typeof ZSubmissionGetParam>;

export const ZSubmissionUpdate = z.object({
  statusId: z.number().int().optional(),
  gradingState: ZSubmissionGradingState.optional(),
  total: z.never().optional(),
  feedback: z.string().optional(),
  reviewerId: z.number().int().optional()
});
export type TSubmissionUpdate = z.infer<typeof ZSubmissionUpdate>;

export const ZSubmissionAnswerUpdate = z.object({
  questionId: z.number().int(),
  optionId: z.number().int().optional(),
  answer: z.string().optional(),
  points: ZSubmissionScore.optional()
});
export type TSubmissionAnswerUpdate = z.infer<typeof ZSubmissionAnswerUpdate>;

/** Batch update for grading: all answer points + submission total/feedback in one request */
export const ZSubmissionGradeItem = z.object({
  questionId: z.number().int(),
  points: ZSubmissionScore
});
export type TSubmissionGradeItem = z.infer<typeof ZSubmissionGradeItem>;

export const ZSubmissionGradesUpdate = z.object({
  answers: z.array(ZSubmissionGradeItem),
  total: ZSubmissionScore,
  feedback: z.string().optional(),
  statusId: z.number().int().min(1).max(3).optional()
});
export type TSubmissionGradesUpdate = z.infer<typeof ZSubmissionGradesUpdate>;
