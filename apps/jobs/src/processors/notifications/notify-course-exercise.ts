import { EmailPreferenceLookupCache } from '@cio/db/queries/notifications';
import { ZNotifyCourseExercisePayload, enqueueEmailSend } from '@cio/jobs';
import { listExerciseNotificationRecipients } from '@cio/db/queries/exercise';

import { log } from '../../utils/logger';

interface NotifyResult {
  notified: number;
}

/**
 * Process a `notifications:notify-course-exercise` job. Fans out one
 * `quizAssigned` email per course member that has an email, each carrying a
 * deep link to take the quiz. Returns how many emails were enqueued (BullMQ
 * stores this as the job return value for the dashboard poll).
 */
export async function processNotifyCourseExercise(rawPayload: unknown, jobId: string): Promise<NotifyResult> {
  const payload = ZNotifyCourseExercisePayload.parse(rawPayload);

  const recipients = await listExerciseNotificationRecipients(payload.courseId, payload.exerciseId);

  let notified = 0;
  const preferenceCache = new EmailPreferenceLookupCache();

  for (const recipient of recipients) {
    try {
      const allowed = await preferenceCache.shouldSend({
        emailId: 'quizAssigned',
        organizationId: payload.organizationId,
        recipientEmail: recipient.email,
        recipientProfileId: recipient.profileId
      });

      if (!allowed) {
        continue;
      }

      await enqueueEmailSend(
        {
          kind: 'template',
          template: 'quizAssigned',
          to: recipient.email,
          fields: {
            orgName: payload.orgName,
            courseName: payload.courseName,
            exerciseTitle: payload.exerciseTitle,
            quizUrl: payload.quizUrl,
            branding: payload.branding
          },
          from: payload.fromName
        },
        // Vary by the notify job id so re-running the nudge re-sends.
        { idempotencyKey: `quiz-assigned:${jobId}:${recipient.email}` }
      );
      notified += 1;
    } catch (error) {
      log.error('notify-course-exercise-enqueue-failed', { jobId, recipient: recipient.email });
      throw error;
    }
  }

  log.info('notify-course-exercise-done', { jobId, courseId: payload.courseId, notified });

  return { notified };
}
