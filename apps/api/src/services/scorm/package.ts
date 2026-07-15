import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import JSZip, { type JSZipObject } from 'jszip';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { parseScormManifest } from './manifest';
import { getAssetById } from '@cio/db/queries/assets';
import {
  attachScormPackageItemToLesson,
  createScormPackageWithItems,
  deleteScormPackage,
  getScormPackage,
  listScormPackages,
  validateScormLessonAttachment
} from '@cio/db/queries/scorm';
import { getS3Client, getStorageConfig } from '@cio/core/config/storage';
import { uploadToS3 } from '@cio/core/utils/s3';

const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 500 * 1024 * 1024;
const MAX_FILE_COUNT = 10_000;

export type ZipObjectWithMetadata = JSZipObject & {
  unsafeOriginalName?: string;
  _data?: { uncompressedSize?: number };
};

function validationError(message: string) {
  return new AppError(new Error(message), ErrorCodes.VALIDATION_ERROR, 400);
}

export function normalizePackagePath(file: ZipObjectWithMetadata): string {
  const originalName = file.unsafeOriginalName ?? file.name;
  if (originalName.includes('\0') || originalName.includes('\\')) {
    throw validationError(`SCORM ZIP contains an unsafe path: ${originalName}`);
  }

  const normalized = path.posix.normalize(originalName);
  const segments = originalName.split('/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    segments.includes('..')
  ) {
    throw validationError(`SCORM ZIP contains an unsafe path: ${originalName}`);
  }

  return normalized.replace(/^\.\//, '');
}

function contentTypeForPath(filePath: string): string {
  const extension = path.posix.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.htm': 'text/html; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8'
  };

  return contentTypes[extension] ?? 'application/octet-stream';
}

async function uploadPackageFiles(
  organizationId: string,
  packageId: string,
  files: { file: JSZipObject; path: string }[]
) {
  const config = getStorageConfig();
  for (let offset = 0; offset < files.length; offset += 20) {
    const batch = files.slice(offset, offset + 20);
    await Promise.all(
      batch.map(async ({ file, path: filePath }) => {
        const body = await file.async('uint8array');
        const upload = await uploadToS3({
          Bucket: config.bucketDocuments,
          Key: `scorm/${organizationId}/${packageId}/${filePath}`,
          Body: body,
          ContentType: contentTypeForPath(filePath)
        });
        if (!upload.success) throw new Error(upload.error ?? `Failed to upload SCORM asset: ${filePath}`);
      })
    );
  }
}

async function deletePackageFiles(organizationId: string, packageId: string) {
  const config = getStorageConfig();
  const client = getS3Client();
  const prefix = `scorm/${organizationId}/${packageId}/`;
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucketDocuments,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );
    const objects = (page.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: config.bucketDocuments, Delete: { Objects: objects } }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

export function validateLaunchTargets(manifest: ReturnType<typeof parseScormManifest>, filePaths: Set<string>) {
  for (const item of manifest.items) {
    if (!item.launchHref) continue;

    const pathWithoutQuery = item.launchHref.split(/[?#]/, 1)[0];
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(pathWithoutQuery);
    } catch {
      throw validationError(`SCORM launch target is not a valid path: ${item.launchHref}`);
    }
    const normalizedPath = path.posix.normalize(decodedPath).replace(/^\.\//, '');
    if (
      decodedPath.includes('\\') ||
      normalizedPath.startsWith('/') ||
      normalizedPath === '..' ||
      normalizedPath.startsWith('../') ||
      /^[A-Za-z][A-Za-z\d+.-]*:/.test(normalizedPath)
    ) {
      throw validationError(`SCORM launch target is unsafe: ${item.launchHref}`);
    }
    if (!filePaths.has(normalizedPath)) {
      throw validationError(`SCORM launch target was not found in the package: ${item.launchHref}`);
    }
  }
}

export async function importScormPackage(
  organizationId: string,
  profileId: string,
  input: { assetId: string; title: string }
) {
  const asset = await getAssetById(input.assetId, organizationId);
  if (!asset || asset.provider !== 'upload' || !asset.storageKey) {
    throw validationError('SCORM source asset was not found');
  }
  if (asset.byteSize && asset.byteSize > MAX_PACKAGE_BYTES) {
    throw validationError('SCORM ZIP exceeds the 100 MB package limit');
  }

  const config = getStorageConfig();
  const source = await getS3Client().send(
    new GetObjectCommand({ Bucket: config.bucketDocuments, Key: asset.storageKey })
  );
  if (!source.Body) throw new Error('SCORM source asset has no content');

  const bytes = await source.Body.transformToByteArray();
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw validationError('SCORM ZIP exceeds the 100 MB package limit');

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch (error) {
    console.error('importScormPackage ZIP parse error:', error);
    throw validationError('SCORM package is not a valid ZIP archive');
  }

  const files = Object.values(archive.files)
    .filter((file) => !file.dir)
    .map((file) => ({ file, path: normalizePackagePath(file as ZipObjectWithMetadata) }));
  if (files.length === 0) throw validationError('SCORM ZIP contains no files');
  if (files.length > MAX_FILE_COUNT) throw validationError(`SCORM ZIP exceeds the ${MAX_FILE_COUNT} file limit`);

  const extractedBytes = files.reduce(
    (total, { file }) => total + ((file as ZipObjectWithMetadata)._data?.uncompressedSize ?? 0),
    0
  );
  if (extractedBytes > MAX_EXTRACTED_BYTES) throw validationError('SCORM ZIP exceeds the 500 MB extracted size limit');

  const manifestFile = files.find(({ path: filePath }) => filePath.toLowerCase() === 'imsmanifest.xml');
  if (!manifestFile) throw validationError('SCORM ZIP is missing imsmanifest.xml at its root');

  const manifestXml = await manifestFile.file.async('string');
  let manifest: ReturnType<typeof parseScormManifest>;
  try {
    manifest = parseScormManifest(manifestXml);
  } catch (error) {
    console.error('importScormPackage manifest parse error:', error);
    throw validationError(error instanceof Error ? error.message : 'SCORM manifest could not be parsed');
  }
  validateLaunchTargets(manifest, new Set(files.map(({ path: filePath }) => filePath)));

  const packageId = randomUUID();
  await uploadPackageFiles(organizationId, packageId, files);

  try {
    return await createScormPackageWithItems(
      {
        id: packageId,
        organizationId,
        createdByProfileId: profileId,
        sourceAssetId: asset.id,
        title: input.title,
        version: manifest.version,
        manifestIdentifier: manifest.identifier,
        entrypoint: manifest.entrypoint,
        status: 'ready',
        manifestJson: manifest,
        warningsJson: manifest.warnings,
        fileCount: files.length
      },
      manifest.items
    );
  } catch (error) {
    await deletePackageFiles(organizationId, packageId);
    throw error;
  }
}

export async function listOrganizationScormPackages(organizationId: string) {
  return listScormPackages(organizationId);
}

export async function attachOrganizationScormPackageItem(
  organizationId: string,
  profileId: string,
  packageId: string,
  input: { courseId: string; lessonId: string; packageItemId: string }
) {
  const valid = await validateScormLessonAttachment({ organizationId, packageId, ...input });
  if (!valid) throw validationError('SCORM package item cannot be attached to this lesson');

  const content = await attachScormPackageItemToLesson({
    organizationId,
    packageId,
    createdByProfileId: profileId,
    ...input
  });
  if (!content) throw new Error('SCORM lesson content was not created');

  return content;
}

export async function getOrganizationScormPackage(organizationId: string, packageId: string) {
  const result = await getScormPackage(organizationId, packageId);
  if (!result) throw new AppError(new Error('SCORM package not found'), ErrorCodes.NOT_FOUND, 404);

  return result;
}

export async function removeOrganizationScormPackage(organizationId: string, packageId: string) {
  await getOrganizationScormPackage(organizationId, packageId);
  const result = await deleteScormPackage(organizationId, packageId);
  if (!result) throw new AppError(new Error('SCORM package not found'), ErrorCodes.NOT_FOUND, 404);

  try {
    await deletePackageFiles(organizationId, packageId);
  } catch (error) {
    console.error('removeOrganizationScormPackage storage cleanup error:', {
      organizationId,
      packageId,
      error
    });
  }

  return result;
}
