import { AppError, ErrorCodes } from '@api/utils/errors';
import type { TScormRuntimeCommit, TScormVersion } from '@cio/utils/validation/scorm';
import { getProfileById } from '@cio/db/queries/auth';
import { getGroupMemberIdByCourseAndProfile } from '@cio/db/queries/group';
import {
  commitScormAttempt,
  getScormAttemptState,
  getScormLessonContentForCourse,
  launchScormAttempt
} from '@cio/db/queries/scorm';

type ScormCompletionStatus = 'unknown' | 'not_attempted' | 'incomplete' | 'completed';
type ScormSuccessStatus = 'unknown' | 'passed' | 'failed';

export type MappedScormRuntime = {
  completionStatus: ScormCompletionStatus;
  successStatus: ScormSuccessStatus;
  scoreRaw: number | null;
  scoreScaled: number | null;
  lastLocation: string | null;
  suspendData: string | null;
  sessionTimeSeconds: number;
};

function asRuntimeSnapshot(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function finiteNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseScormDurationSeconds(value: string | undefined, version: TScormVersion): number {
  if (!value) return 0;
  if (version === '1.2') {
    const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
    if (!match) return 0;

    return Math.round(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
  }

  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match) return 0;

  return Math.round(
    Number(match[1] ?? 0) * 86_400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0)
  );
}

export function mapScormRuntime(snapshot: Record<string, string>, version: TScormVersion): MappedScormRuntime {
  if (version === '1.2') {
    const lessonStatus = snapshot['cmi.core.lesson_status']?.toLowerCase();
    const completionStatus: ScormCompletionStatus =
      lessonStatus === 'completed' || lessonStatus === 'passed' || lessonStatus === 'failed'
        ? 'completed'
        : lessonStatus === 'incomplete' || lessonStatus === 'browsed'
          ? 'incomplete'
          : lessonStatus === 'not attempted'
            ? 'not_attempted'
            : 'unknown';
    const successStatus: ScormSuccessStatus =
      lessonStatus === 'passed' ? 'passed' : lessonStatus === 'failed' ? 'failed' : 'unknown';

    return {
      completionStatus,
      successStatus,
      scoreRaw: finiteNumber(snapshot['cmi.core.score.raw']),
      scoreScaled: null,
      lastLocation: snapshot['cmi.core.lesson_location'] ?? null,
      suspendData: snapshot['cmi.suspend_data'] ?? null,
      sessionTimeSeconds: parseScormDurationSeconds(snapshot['cmi.core.session_time'], version)
    };
  }

  const completion = snapshot['cmi.completion_status']?.toLowerCase();
  const success = snapshot['cmi.success_status']?.toLowerCase();
  return {
    completionStatus:
      completion === 'completed'
        ? 'completed'
        : completion === 'incomplete'
          ? 'incomplete'
          : completion === 'not attempted'
            ? 'not_attempted'
            : 'unknown',
    successStatus: success === 'passed' ? 'passed' : success === 'failed' ? 'failed' : 'unknown',
    scoreRaw: finiteNumber(snapshot['cmi.score.raw']),
    scoreScaled: finiteNumber(snapshot['cmi.score.scaled']),
    lastLocation: snapshot['cmi.location'] ?? null,
    suspendData: snapshot['cmi.suspend_data'] ?? null,
    sessionTimeSeconds: parseScormDurationSeconds(snapshot['cmi.session_time'], version)
  };
}

export async function launchScormRuntime(courseId: string, lessonId: string, profileId: string) {
  const [groupMemberId, profile] = await Promise.all([
    getGroupMemberIdByCourseAndProfile(courseId, profileId),
    getProfileById(profileId)
  ]);
  const result = await launchScormAttempt(courseId, lessonId, profileId, groupMemberId ?? null);
  if (!result) throw new AppError(new Error('SCORM lesson not found'), ErrorCodes.NOT_FOUND, 404);

  const snapshot = asRuntimeSnapshot(result.attempt.runtimeSnapshotJson);
  const learnerName = profile?.fullname ?? profile?.email ?? profileId;
  const learnerValues =
    result.package.version === '1.2'
      ? { 'cmi.core.student_id': profileId, 'cmi.core.student_name': learnerName }
      : { 'cmi.learner_id': profileId, 'cmi.learner_name': learnerName };

  return {
    attemptId: result.attempt.id,
    version: result.package.version,
    launchPath: result.packageItem.launchHref,
    values: { ...learnerValues, ...snapshot }
  };
}

export async function getScormLessonMetadata(courseId: string, lessonId: string) {
  const result = await getScormLessonContentForCourse(courseId, lessonId);
  if (!result) return null;

  return {
    packageId: result.package.id,
    packageItemId: result.packageItem.id,
    title: result.packageItem.title,
    version: result.package.version
  };
}

export async function getScormRuntimeState(courseId: string, lessonId: string, profileId: string) {
  const result = await getScormAttemptState(courseId, lessonId, profileId);
  if (!result) return null;

  return {
    attemptId: result.attempt.id,
    status: result.attempt.status,
    values: asRuntimeSnapshot(result.attempt.runtimeSnapshotJson),
    registration: result.registration
  };
}

export async function saveScormRuntime(
  courseId: string,
  lessonId: string,
  profileId: string,
  input: TScormRuntimeCommit,
  terminate: boolean
) {
  const current = await getScormAttemptState(courseId, lessonId, profileId, input.attemptId);
  if (!current || current.attempt.status !== 'active') {
    throw new AppError(new Error('Active SCORM attempt not found'), ErrorCodes.NOT_FOUND, 404);
  }

  const snapshot = { ...asRuntimeSnapshot(current.attempt.runtimeSnapshotJson), ...input.values };
  const version: TScormVersion =
    'cmi.core.lesson_status' in snapshot || 'cmi.core.session_time' in snapshot ? '1.2' : '2004';
  const mapped = mapScormRuntime(snapshot, version);
  const sessionTimeSeconds = input.sessionTimeSeconds ?? mapped.sessionTimeSeconds;
  const additionalTime = Math.max(0, sessionTimeSeconds - current.attempt.sessionTimeSeconds);
  const events: { eventType: string; element?: string; valuePreview?: string }[] = Object.entries(input.values).map(
    ([element, value]) => ({
      eventType: 'set_value',
      element,
      valuePreview: value.slice(0, 500)
    })
  );
  events.push({ eventType: terminate ? 'terminate' : 'commit' });

  const result = await commitScormAttempt({
    attemptId: input.attemptId,
    courseId,
    lessonId,
    profileId,
    runtimeSnapshotJson: snapshot,
    ...mapped,
    sessionTimeSeconds,
    totalTimeSeconds: current.registration.totalTimeSeconds + additionalTime,
    terminate,
    events
  });
  if (!result) throw new AppError(new Error('Active SCORM attempt not found'), ErrorCodes.NOT_FOUND, 404);

  return result;
}
