import * as schema from '@db/schema';

import { and, count, db, desc, eq } from '@db/drizzle';

export async function listScormRegistrations(organizationId: string, page: number, limit: number) {
  try {
    const offset = (page - 1) * limit;
    const scope = eq(schema.group.organizationId, organizationId);
    const [items, totalRows] = await Promise.all([
      db
        .select({
          registration: schema.scormRegistration,
          learner: {
            id: schema.profile.id,
            fullname: schema.profile.fullname,
            email: schema.profile.email
          },
          course: { id: schema.course.id, title: schema.course.title },
          lesson: { id: schema.lesson.id, title: schema.lesson.title },
          package: {
            id: schema.scormPackage.id,
            title: schema.scormPackage.title,
            version: schema.scormPackage.version
          },
          packageItem: { id: schema.scormPackageItem.id, title: schema.scormPackageItem.title }
        })
        .from(schema.scormRegistration)
        .innerJoin(schema.profile, eq(schema.scormRegistration.profileId, schema.profile.id))
        .innerJoin(schema.course, eq(schema.scormRegistration.courseId, schema.course.id))
        .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
        .innerJoin(schema.lesson, eq(schema.scormRegistration.lessonId, schema.lesson.id))
        .innerJoin(schema.scormPackage, eq(schema.scormRegistration.packageId, schema.scormPackage.id))
        .innerJoin(schema.scormPackageItem, eq(schema.scormRegistration.packageItemId, schema.scormPackageItem.id))
        .where(scope)
        .orderBy(desc(schema.scormRegistration.updatedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: count() })
        .from(schema.scormRegistration)
        .innerJoin(schema.course, eq(schema.scormRegistration.courseId, schema.course.id))
        .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
        .where(scope)
    ]);
    const total = totalRows[0]?.count ?? 0;

    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  } catch (error) {
    console.error('listScormRegistrations error:', error);
    throw new Error('Failed to list SCORM registrations');
  }
}

export async function getScormRegistrationReport(organizationId: string, registrationId: string) {
  try {
    const [registration] = await db
      .select({ registration: schema.scormRegistration })
      .from(schema.scormRegistration)
      .innerJoin(schema.course, eq(schema.scormRegistration.courseId, schema.course.id))
      .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
      .where(and(eq(schema.scormRegistration.id, registrationId), eq(schema.group.organizationId, organizationId)))
      .limit(1);
    if (!registration) return null;

    const attempts = await db
      .select()
      .from(schema.scormAttempt)
      .where(eq(schema.scormAttempt.registrationId, registrationId))
      .orderBy(desc(schema.scormAttempt.attemptNumber));

    return { registration: registration.registration, attempts };
  } catch (error) {
    console.error('getScormRegistrationReport error:', error);
    throw new Error('Failed to get SCORM registration report');
  }
}
