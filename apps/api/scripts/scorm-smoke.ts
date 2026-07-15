import JSZip from 'jszip';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

import * as schema from '@cio/db/schema';
import { db } from '@cio/db/drizzle';
import { and, eq } from 'drizzle-orm';
import { getS3Client, getStorageConfig } from '@cio/core/config/storage';
import { uploadToS3 } from '@cio/core/utils/s3';
import {
  attachOrganizationScormPackageItem,
  importScormPackage,
  removeOrganizationScormPackage
} from '../src/services/scorm/package';
import { getScormRuntimeState, launchScormRuntime, saveScormRuntime } from '../src/services/scorm/runtime';
import { listScormRegistrations } from '@cio/db/queries/scorm';

async function run() {
  const [context] = await db
    .select({
      organizationId: schema.organization.id,
      profileId: schema.groupmember.profileId,
      courseId: schema.course.id,
      lessonId: schema.lesson.id
    })
    .from(schema.lesson)
    .innerJoin(schema.course, eq(schema.lesson.courseId, schema.course.id))
    .innerJoin(schema.group, eq(schema.course.groupId, schema.group.id))
    .innerJoin(schema.organization, eq(schema.group.organizationId, schema.organization.id))
    .innerJoin(schema.groupmember, eq(schema.groupmember.groupId, schema.group.id))
    .limit(1);
  if (!context?.profileId) throw new Error('Seed course member and lesson not found');

  const [previousCompletion] = await db
    .select()
    .from(schema.lessonCompletion)
    .where(
      and(
        eq(schema.lessonCompletion.lessonId, context.lessonId),
        eq(schema.lessonCompletion.profileId, context.profileId)
      )
    )
    .limit(1);

  const zip = new JSZip();
  zip.file(
    'imsmanifest.xml',
    '<manifest identifier="smoke"><metadata><schemaversion>1.2</schemaversion></metadata><organizations><organization identifier="org"><title>SCORM Smoke</title><item identifier="sco" identifierref="res"><title>Smoke lesson</title></item></organization></organizations><resources><resource identifier="res" href="index.html" /></resources></manifest>'
  );
  zip.file('index.html', '<!doctype html><title>SCORM smoke</title>');
  const body = await zip.generateAsync({ type: 'uint8array' });
  const sourceKey = `smoke/${randomUUID()}.zip`;
  const config = getStorageConfig();
  const upload = await uploadToS3({
    Bucket: config.bucketDocuments,
    Key: sourceKey,
    Body: body,
    ContentType: 'application/zip'
  });
  if (!upload.success) throw new Error(upload.error ?? 'Source upload failed');

  const [asset] = await db
    .insert(schema.asset)
    .values({
      organizationId: context.organizationId,
      createdByProfileId: context.profileId,
      kind: 'document',
      provider: 'upload',
      storageKey: sourceKey,
      mimeType: 'application/zip',
      byteSize: body.byteLength,
      title: 'SCORM smoke source'
    })
    .returning();
  if (!asset) throw new Error('Smoke asset was not created');

  let packageId: string | null = null;
  try {
    const imported = await importScormPackage(context.organizationId, context.profileId, {
      assetId: asset.id,
      title: 'SCORM smoke'
    });
    packageId = imported.package.id;
    if (imported.items.length !== 1 || imported.package.version !== '1.2') {
      throw new Error('Unexpected SCORM import result');
    }
    const packageItem = imported.items[0];
    if (!packageItem) throw new Error('SCORM package item was not created');

    await attachOrganizationScormPackageItem(context.organizationId, context.profileId, packageId, {
      courseId: context.courseId,
      lessonId: context.lessonId,
      packageItemId: packageItem.id
    });
    const launch = await launchScormRuntime(context.courseId, context.lessonId, context.profileId);
    await saveScormRuntime(
      context.courseId,
      context.lessonId,
      context.profileId,
      {
        attemptId: launch.attemptId,
        values: {
          'cmi.core.lesson_status': 'passed',
          'cmi.core.score.raw': '90',
          'cmi.core.session_time': '00:10:00',
          'cmi.core.lesson_location': 'slide-5'
        }
      },
      false
    );
    await saveScormRuntime(
      context.courseId,
      context.lessonId,
      context.profileId,
      { attemptId: launch.attemptId, values: {} },
      true
    );
    const runtimeState = await getScormRuntimeState(context.courseId, context.lessonId, context.profileId);
    const [completion] = await db
      .select()
      .from(schema.lessonCompletion)
      .where(
        and(
          eq(schema.lessonCompletion.lessonId, context.lessonId),
          eq(schema.lessonCompletion.profileId, context.profileId)
        )
      )
      .limit(1);
    if (runtimeState?.status !== 'terminated' || completion?.isComplete !== true) {
      throw new Error('SCORM runtime persistence is incomplete');
    }

    const reports = await listScormRegistrations(context.organizationId, 1, 20);
    const foreignReports = await listScormRegistrations(randomUUID(), 1, 20);
    if (
      !reports.items.some((item) => item.registration.id === runtimeState.registration.id) ||
      foreignReports.total !== 0
    ) {
      throw new Error('SCORM report tenant isolation failed');
    }

    const prefix = `scorm/${context.organizationId}/${packageId}/`;
    const listed = await getS3Client().send(
      new ListObjectsV2Command({ Bucket: config.bucketDocuments, Prefix: prefix })
    );
    if ((listed.KeyCount ?? 0) !== 2) throw new Error('Extracted SCORM objects are incomplete');

    await removeOrganizationScormPackage(context.organizationId, packageId);
    const remaining = await getS3Client().send(
      new ListObjectsV2Command({ Bucket: config.bucketDocuments, Prefix: prefix })
    );
    const packageRows = await db
      .select({ id: schema.scormPackage.id })
      .from(schema.scormPackage)
      .where(eq(schema.scormPackage.id, packageId));
    if ((remaining.KeyCount ?? 0) !== 0 || packageRows.length !== 0) throw new Error('SCORM cleanup failed');

    console.log('SCORM_SMOKE_OK files=2 items=1 runtime=terminated completion=complete reports=isolated cleanup=clean');
  } finally {
    if (packageId) await db.delete(schema.scormPackage).where(eq(schema.scormPackage.id, packageId));
    await db.delete(schema.asset).where(eq(schema.asset.id, asset.id));
    await getS3Client().send(new DeleteObjectCommand({ Bucket: config.bucketDocuments, Key: sourceKey }));
    if (previousCompletion) {
      await db
        .update(schema.lessonCompletion)
        .set({
          isComplete: previousCompletion.isComplete,
          createdAt: previousCompletion.createdAt,
          updatedAt: previousCompletion.updatedAt
        })
        .where(eq(schema.lessonCompletion.id, previousCompletion.id));
    } else {
      await db
        .delete(schema.lessonCompletion)
        .where(
          and(
            eq(schema.lessonCompletion.lessonId, context.lessonId),
            eq(schema.lessonCompletion.profileId, context.profileId)
          )
        );
    }
  }
}

run().catch((error) => {
  console.error('SCORM smoke failed:', error);
  process.exitCode = 1;
});
