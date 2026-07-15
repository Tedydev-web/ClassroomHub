import * as schema from '@db/schema';

import type { TNewScormPackage, TScormPackageItem } from '@db/types';
import { and, db, desc, eq } from '@db/drizzle';

export type ScormPackageItemInput = {
  identifier: string;
  parentIdentifier: string | null;
  resourceIdentifier: string | null;
  title: string;
  launchHref: string | null;
  isLaunchable: boolean;
  order: number;
  metadataJson?: Record<string, unknown>;
};

export async function createScormPackageWithItems(data: TNewScormPackage, items: ScormPackageItemInput[]) {
  try {
    return await db.transaction(async (tx) => {
      const [createdPackage] = await tx.insert(schema.scormPackage).values(data).returning();
      if (!createdPackage) throw new Error('SCORM package was not created');

      const createdItems: TScormPackageItem[] = [];
      const itemIds = new Map<string, string>();
      for (const item of items) {
        const parentItemId = item.parentIdentifier ? itemIds.get(item.parentIdentifier) : undefined;
        if (item.parentIdentifier && !parentItemId) {
          throw new Error(`SCORM parent item was not created: ${item.parentIdentifier}`);
        }

        const [createdItem] = await tx
          .insert(schema.scormPackageItem)
          .values({
            packageId: createdPackage.id,
            parentItemId,
            title: item.title,
            identifier: item.identifier,
            resourceIdentifier: item.resourceIdentifier,
            launchHref: item.launchHref,
            order: item.order,
            isLaunchable: item.isLaunchable,
            metadataJson: item.metadataJson ?? {}
          })
          .returning();
        if (!createdItem) throw new Error(`SCORM package item was not created: ${item.identifier}`);

        itemIds.set(item.identifier, createdItem.id);
        createdItems.push(createdItem);
      }

      return { package: createdPackage, items: createdItems };
    });
  } catch (error) {
    console.error('createScormPackageWithItems error:', error);
    throw new Error('Failed to create SCORM package');
  }
}

export async function listScormPackages(organizationId: string) {
  try {
    return await db
      .select()
      .from(schema.scormPackage)
      .where(eq(schema.scormPackage.organizationId, organizationId))
      .orderBy(desc(schema.scormPackage.createdAt));
  } catch (error) {
    console.error('listScormPackages error:', error);
    throw new Error('Failed to list SCORM packages');
  }
}

export async function getScormPackage(organizationId: string, packageId: string) {
  try {
    const [packageRecord] = await db
      .select()
      .from(schema.scormPackage)
      .where(and(eq(schema.scormPackage.id, packageId), eq(schema.scormPackage.organizationId, organizationId)))
      .limit(1);
    if (!packageRecord) return null;

    const items = await db
      .select()
      .from(schema.scormPackageItem)
      .where(eq(schema.scormPackageItem.packageId, packageId))
      .orderBy(schema.scormPackageItem.order);

    return { package: packageRecord, items };
  } catch (error) {
    console.error('getScormPackage error:', error);
    throw new Error('Failed to get SCORM package');
  }
}

export async function deleteScormPackage(organizationId: string, packageId: string) {
  try {
    const [deleted] = await db
      .delete(schema.scormPackage)
      .where(and(eq(schema.scormPackage.id, packageId), eq(schema.scormPackage.organizationId, organizationId)))
      .returning({ id: schema.scormPackage.id });

    return deleted ?? null;
  } catch (error) {
    console.error('deleteScormPackage error:', error);
    throw new Error('Failed to delete SCORM package');
  }
}

export async function attachScormPackageItemToLesson(data: {
  organizationId: string;
  courseId: string;
  lessonId: string;
  packageId: string;
  packageItemId: string;
  createdByProfileId: string;
}) {
  try {
    const [content] = await db
      .insert(schema.scormLessonContent)
      .values(data)
      .onConflictDoUpdate({
        target: schema.scormLessonContent.lessonId,
        set: {
          organizationId: data.organizationId,
          courseId: data.courseId,
          packageId: data.packageId,
          packageItemId: data.packageItemId,
          createdByProfileId: data.createdByProfileId,
          updatedAt: new Date().toISOString()
        }
      })
      .returning();

    return content ?? null;
  } catch (error) {
    console.error('attachScormPackageItemToLesson error:', error);
    throw new Error('Failed to attach SCORM package item to lesson');
  }
}

export async function getScormLessonContent(organizationId: string, courseId: string, lessonId: string) {
  try {
    const [content] = await db
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
          eq(schema.scormLessonContent.organizationId, organizationId),
          eq(schema.scormLessonContent.courseId, courseId),
          eq(schema.scormLessonContent.lessonId, lessonId)
        )
      )
      .limit(1);

    return content ?? null;
  } catch (error) {
    console.error('getScormLessonContent error:', error);
    throw new Error('Failed to get SCORM lesson content');
  }
}

export async function getScormLessonContentForCourse(courseId: string, lessonId: string) {
  try {
    const [content] = await db
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
          eq(schema.scormPackage.status, 'ready')
        )
      )
      .limit(1);

    return content ?? null;
  } catch (error) {
    console.error('getScormLessonContentForCourse error:', error);
    throw new Error('Failed to get SCORM lesson content');
  }
}

export async function validateScormLessonAttachment(input: {
  organizationId: string;
  courseId: string;
  lessonId: string;
  packageId: string;
  packageItemId: string;
}) {
  try {
    const [result] = await db
      .select({ packageItemId: schema.scormPackageItem.id })
      .from(schema.lesson)
      .innerJoin(schema.course, eq(schema.lesson.courseId, schema.course.id))
      .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
      .innerJoin(schema.scormPackage, eq(schema.scormPackage.organizationId, schema.group.organizationId))
      .innerJoin(schema.scormPackageItem, eq(schema.scormPackageItem.packageId, schema.scormPackage.id))
      .where(
        and(
          eq(schema.group.organizationId, input.organizationId),
          eq(schema.course.id, input.courseId),
          eq(schema.lesson.id, input.lessonId),
          eq(schema.scormPackage.id, input.packageId),
          eq(schema.scormPackage.status, 'ready'),
          eq(schema.scormPackageItem.id, input.packageItemId),
          eq(schema.scormPackageItem.isLaunchable, true)
        )
      )
      .limit(1);

    return result ?? null;
  } catch (error) {
    console.error('validateScormLessonAttachment error:', error);
    throw new Error('Failed to validate SCORM lesson attachment');
  }
}
