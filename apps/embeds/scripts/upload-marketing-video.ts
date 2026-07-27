import { readFile } from 'node:fs/promises';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const environment = process['env'];
const accountId = environment['R2_ACCOUNT_ID'];
const accessKeyId = environment['R2_ACCESS_KEY'];
const secretAccessKey = environment['R2_SECRET_ACCESS_KEY'];

if (!accountId || !accessKeyId || !secretAccessKey) {
  throw new Error('Missing Cloudflare R2 credentials.');
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey }
});

await client.send(
  new PutObjectCommand({
    Bucket: 'assets',
    Key: 'marketing/language-editor-demo.mov',
    Body: await readFile('../website/marketing-assets/language-editor-demo.mov'),
    ContentType: 'video/quicktime',
    CacheControl: 'public, max-age=31536000, immutable'
  })
);
