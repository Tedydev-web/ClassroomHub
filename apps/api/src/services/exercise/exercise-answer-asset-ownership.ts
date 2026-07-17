type ExerciseAnswerAssetSource = 'exercise_file_upload' | 'exercise_video_recording';

type ExerciseAnswerAssetOwnership = {
  source: ExerciseAnswerAssetSource;
  courseId: string;
  exerciseId: string;
  questionId: number;
  groupMemberId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function hasExerciseAnswerAssetOwnership(metadata: unknown, expected: ExerciseAnswerAssetOwnership): boolean {
  if (!isRecord(metadata)) return false;

  return (
    metadata.source === expected.source &&
    metadata.courseId === expected.courseId &&
    metadata.exerciseId === expected.exerciseId &&
    metadata.questionId === expected.questionId &&
    metadata.groupMemberId === expected.groupMemberId
  );
}
