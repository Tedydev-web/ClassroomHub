import * as schema from '@db/schema';

import { and, db, desc, eq, max, sql } from '@db/drizzle';

export async function launchScormAttempt(
  courseId: string,
  lessonId: string,
  profileId: string,
  groupMemberId: string | null
) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${lessonId}:${profileId}`}, 0))`);

      const [content] = await tx
        .select({
          content: schema.scormLessonContent,
          package: schema.scormPackage,
          packageItem: schema.scormPackageItem
        })
        .from(schema.scormLessonContent)
        .innerJoin(schema.scormPackage, eq(schema.scormLessonContent.packageId, schema.scormPackage.id))
        .innerJoin(schema.scormPackageItem, eq(schema.scormLessonContent.packageItemId, schema.scormPackageItem.id))
        .where(
          and(
            eq(schema.scormLessonContent.courseId, courseId),
            eq(schema.scormLessonContent.lessonId, lessonId),
            eq(schema.scormPackage.status, 'ready'),
            eq(schema.scormPackageItem.isLaunchable, true)
          )
        )
        .limit(1);
      if (!content) return null;

      await tx
        .insert(schema.scormRegistration)
        .values({
          packageId: content.content.packageId,
          packageItemId: content.content.packageItemId,
          courseId,
          lessonId,
          profileId,
          groupMemberId,
          status: 'in_progress',
          lastLaunchedAt: new Date().toISOString()
        })
        .onConflictDoNothing({ target: [schema.scormRegistration.lessonId, schema.scormRegistration.profileId] });

      const [registration] = await tx
        .select()
        .from(schema.scormRegistration)
        .where(and(eq(schema.scormRegistration.lessonId, lessonId), eq(schema.scormRegistration.profileId, profileId)))
        .limit(1);
      if (!registration) throw new Error('SCORM registration was not created');

      let [attempt] = await tx
        .select()
        .from(schema.scormAttempt)
        .where(and(eq(schema.scormAttempt.registrationId, registration.id), eq(schema.scormAttempt.status, 'active')))
        .limit(1);
      if (!attempt) {
        const [attemptCount] = await tx
          .select({ value: max(schema.scormAttempt.attemptNumber) })
          .from(schema.scormAttempt)
          .where(eq(schema.scormAttempt.registrationId, registration.id));
        const [createdAttempt] = await tx
          .insert(schema.scormAttempt)
          .values({
            registrationId: registration.id,
            attemptNumber: (attemptCount?.value ?? 0) + 1,
            initializedAt: new Date().toISOString()
          })
          .returning();
        if (!createdAttempt) throw new Error('SCORM attempt was not created');
        attempt = createdAttempt;
      }

      const [updatedRegistration] = await tx
        .update(schema.scormRegistration)
        .set({
          status: 'in_progress',
          groupMemberId,
          lastLaunchedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .where(eq(schema.scormRegistration.id, registration.id))
        .returning();

      await tx.insert(schema.scormRuntimeEvent).values({ attemptId: attempt.id, eventType: 'initialize' });

      return { ...content, registration: updatedRegistration ?? registration, attempt };
    });
  } catch (error) {
    console.error('launchScormAttempt error:', error);
    throw new Error('Failed to launch SCORM attempt');
  }
}

export async function getScormAttemptState(courseId: string, lessonId: string, profileId: string, attemptId?: string) {
  try {
    const conditions = [
      eq(schema.scormRegistration.courseId, courseId),
      eq(schema.scormRegistration.lessonId, lessonId),
      eq(schema.scormRegistration.profileId, profileId)
    ];
    if (attemptId) conditions.push(eq(schema.scormAttempt.id, attemptId));

    const [result] = await db
      .select({ registration: schema.scormRegistration, attempt: schema.scormAttempt })
      .from(schema.scormRegistration)
      .innerJoin(schema.scormAttempt, eq(schema.scormAttempt.registrationId, schema.scormRegistration.id))
      .where(and(...conditions))
      .orderBy(desc(schema.scormAttempt.attemptNumber))
      .limit(1);

    return result ?? null;
  } catch (error) {
    console.error('getScormAttemptState error:', error);
    throw new Error('Failed to get SCORM attempt state');
  }
}

export async function commitScormAttempt(input: {
  attemptId: string;
  courseId: string;
  lessonId: string;
  profileId: string;
  runtimeSnapshotJson: Record<string, string>;
  completionStatus: 'unknown' | 'not_attempted' | 'incomplete' | 'completed';
  successStatus: 'unknown' | 'passed' | 'failed';
  scoreRaw: number | null;
  scoreScaled: number | null;
  totalTimeSeconds: number;
  sessionTimeSeconds: number;
  lastLocation: string | null;
  suspendData: string | null;
  terminate: boolean;
  events: { eventType: string; element?: string; valuePreview?: string; errorCode?: string }[];
}) {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ registration: schema.scormRegistration, attempt: schema.scormAttempt })
        .from(schema.scormAttempt)
        .innerJoin(schema.scormRegistration, eq(schema.scormAttempt.registrationId, schema.scormRegistration.id))
        .where(
          and(
            eq(schema.scormAttempt.id, input.attemptId),
            eq(schema.scormRegistration.courseId, input.courseId),
            eq(schema.scormRegistration.lessonId, input.lessonId),
            eq(schema.scormRegistration.profileId, input.profileId)
          )
        )
        .limit(1);
      if (!current || current.attempt.status !== 'active') return null;

      const now = new Date().toISOString();
      const isComplete = input.completionStatus === 'completed' || input.successStatus === 'passed';
      const [attempt] = await tx
        .update(schema.scormAttempt)
        .set({
          runtimeSnapshotJson: input.runtimeSnapshotJson,
          sessionTimeSeconds: input.sessionTimeSeconds,
          lastCommittedAt: now,
          status: input.terminate ? 'terminated' : 'active',
          terminatedAt: input.terminate ? now : null,
          updatedAt: now
        })
        .where(eq(schema.scormAttempt.id, input.attemptId))
        .returning();

      const [registration] = await tx
        .update(schema.scormRegistration)
        .set({
          status: isComplete ? 'completed' : 'in_progress',
          completionStatus: input.completionStatus,
          successStatus: input.successStatus,
          scoreRaw: input.scoreRaw,
          scoreScaled: input.scoreScaled,
          totalTimeSeconds: input.totalTimeSeconds,
          lastLocation: input.lastLocation,
          suspendData: input.suspendData,
          lastCommittedAt: now,
          completedAt: isComplete ? (current.registration.completedAt ?? now) : null,
          passedAt: input.successStatus === 'passed' ? (current.registration.passedAt ?? now) : null,
          failedAt: input.successStatus === 'failed' ? (current.registration.failedAt ?? now) : null,
          updatedAt: now
        })
        .where(eq(schema.scormRegistration.id, current.registration.id))
        .returning();

      if (isComplete) {
        await tx
          .insert(schema.lessonCompletion)
          .values({ lessonId: input.lessonId, profileId: input.profileId, isComplete: true, updatedAt: now })
          .onConflictDoUpdate({
            target: [schema.lessonCompletion.lessonId, schema.lessonCompletion.profileId],
            set: { isComplete: true, updatedAt: now }
          });
      }
      if (input.events.length > 0) {
        await tx.insert(schema.scormRuntimeEvent).values(
          input.events.map((event) => ({
            attemptId: input.attemptId,
            eventType: event.eventType,
            element: event.element,
            valuePreview: event.valuePreview,
            errorCode: event.errorCode
          }))
        );
      }

      return { attempt, registration };
    });
  } catch (error) {
    console.error('commitScormAttempt error:', error);
    throw new Error('Failed to commit SCORM attempt');
  }
}
