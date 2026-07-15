import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseEnvValues } from '../dev-environment-utils.mjs';
import { runSetupEnv } from '../setup-dev.mjs';

const EXAMPLES = new Map([
  [
    '.env.dev.example',
    'DEV_PUBLIC_HOST=localhost\nDEV_PUBLIC_PROTOCOL=http\nDEV_DASHBOARD_PUBLIC_PORT=5173\nDEV_API_PUBLIC_PORT=3002\nDEV_REDIRECT_HOST=\nPOSTGRES_PORT=5432\nREDIS_PORT=6379\nMINIO_API_PORT=9000\nMINIO_CONSOLE_PORT=9001\nMAILPIT_SMTP_PORT=1025\nMAILPIT_UI_PORT=8025\n'
  ],
  ['apps/api/.env.example', 'DATABASE_URL=""\nREDIS_URL=""\nBETTER_AUTH_SECRET=""\nUNKNOWN_API_KEY="preserve-me"\n'],
  [
    'apps/dashboard/.env.example',
    'PUBLIC_IS_SELFHOSTED=false\nPUBLIC_SERVER_URL=\nPRIVATE_APP_HOST=classroom.tedydev.io.vn\n'
  ],
  ['apps/jobs/.env.example', 'REDIS_URL="redis://localhost:6379"\nDATABASE_URL=""\n'],
  ['packages/db/.env.example', 'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/classroomio"\n']
]);

async function createFixture() {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'classroomio-setup-'));
  for (const [relativePath, content] of EXAMPLES) {
    const filePath = path.join(rootDirectory, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  return rootDirectory;
}

async function readValues(rootDirectory, relativePath) {
  return parseEnvValues(await readFile(path.join(rootDirectory, relativePath), 'utf8'));
}

test('creates all env files with shared secrets and preserves unknown values', async () => {
  const rootDirectory = await createFixture();
  const result = await runSetupEnv({ rootDirectory });
  const api = await readValues(rootDirectory, 'apps/api/.env');
  const dashboard = await readValues(rootDirectory, 'apps/dashboard/.env');
  const jobs = await readValues(rootDirectory, 'apps/jobs/.env');

  assert.equal(result.changedFiles.length, 4);
  assert.equal(await readFile(path.join(rootDirectory, '.env.dev'), 'utf8'), EXAMPLES.get('.env.dev.example'));
  assert.equal(api.get('PRIVATE_SERVER_KEY'), dashboard.get('PRIVATE_SERVER_KEY'));
  assert.equal(api.get('WEBHOOK_ENCRYPTION_KEY'), jobs.get('WEBHOOK_ENCRYPTION_KEY'));
  assert.ok((api.get('HLS_SIGNING_SECRET') ?? '').length >= 32);
  assert.equal(api.get('UNKNOWN_API_KEY'), 'preserve-me');
  assert.equal(api.get('PUBLIC_IS_SELFHOSTED'), 'false');
  assert.equal(api.get('PUBLIC_IS_SELF_OWNED'), 'true');
  assert.equal(dashboard.get('PUBLIC_IS_SELF_OWNED'), 'true');
  assert.equal(jobs.get('PUBLIC_IS_SELF_OWNED'), 'true');
  assert.equal(dashboard.get('PRIVATE_APP_HOST'), 'localhost');
});

test('is idempotent and preserves existing strong secrets', async () => {
  const rootDirectory = await createFixture();
  await runSetupEnv({ rootDirectory });
  const firstApi = await readValues(rootDirectory, 'apps/api/.env');
  const secondResult = await runSetupEnv({ rootDirectory });
  const secondApi = await readValues(rootDirectory, 'apps/api/.env');

  assert.equal(secondApi.get('BETTER_AUTH_SECRET'), firstApi.get('BETTER_AUTH_SECRET'));
  assert.equal(secondApi.get('PRIVATE_SERVER_KEY'), firstApi.get('PRIVATE_SERVER_KEY'));
  assert.equal(secondApi.get('WEBHOOK_ENCRYPTION_KEY'), firstApi.get('WEBHOOK_ENCRYPTION_KEY'));
  assert.equal(secondApi.get('HLS_SIGNING_SECRET'), firstApi.get('HLS_SIGNING_SECRET'));
  assert.deepEqual(secondResult.changedFiles, []);
});

test('reports managed conflicts without exposing values', async () => {
  const rootDirectory = await createFixture();
  await writeFile(path.join(rootDirectory, 'apps/api/.env'), 'DATABASE_URL="postgresql://private.example/secret"\n');

  await assert.rejects(
    runSetupEnv({ rootDirectory }),
    (error) => error.message.includes('apps/api/.env: DATABASE_URL') && !error.message.includes('private.example')
  );
});

test('explicit mode updates only mode values while local-default consent resolves endpoints', async () => {
  const rootDirectory = await createFixture();
  await runSetupEnv({ rootDirectory });
  await runSetupEnv({ args: ['--mode=self-hosted'], rootDirectory });
  const api = await readValues(rootDirectory, 'apps/api/.env');
  const dashboard = await readValues(rootDirectory, 'apps/dashboard/.env');

  assert.equal(api.get('PUBLIC_IS_SELFHOSTED'), 'true');
  assert.equal(dashboard.get('PUBLIC_IS_SELFHOSTED'), 'true');
  assert.equal(api.get('PUBLIC_IS_SELF_OWNED'), 'true');
  assert.equal(dashboard.get('PUBLIC_IS_SELF_OWNED'), 'true');

  await writeFile(path.join(rootDirectory, 'packages/db/.env'), 'DATABASE_URL="postgresql://external/db"\n');
  await runSetupEnv({ args: ['--apply-local-defaults'], rootDirectory });
  const database = await readValues(rootDirectory, 'packages/db/.env');
  assert.equal(database.get('DATABASE_URL'), 'postgresql://postgres:postgres@localhost:5432/classroomio');
});

test('development Compose pins images and binds parameterized ports to loopback', async () => {
  const composePath = path.resolve(import.meta.dirname, '..', '..', 'docker-compose.dev.yaml');
  const compose = await readFile(composePath, 'utf8');
  const imageReferences = [...compose.matchAll(/^\s+image:\s+(.+)$/gm)].map((match) => match[1]);

  assert.equal(imageReferences.length, 5);
  for (const imageReference of imageReferences) {
    assert.doesNotMatch(imageReference, /:latest$/);
    assert.match(
      imageReference,
      /:(?:v?\d+\.\d+\.\d+(?:-alpine\d+\.\d+)?|\d+\.\d+-alpine\d+\.\d+|RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)/
    );
  }

  assert.match(compose, /127\.0\.0\.1:\$\{POSTGRES_PORT:-5432\}:5432/);
  assert.match(compose, /127\.0\.0\.1:\$\{MAILPIT_UI_PORT:-8025\}:8025/);
  assert.match(compose, /mc mb --ignore-existing local\/videos local\/documents local\/media/);
  assert.match(compose, /mc anonymous set download local\/media/);
});

test('uses alternate infrastructure ports in generated endpoints', async () => {
  const rootDirectory = await createFixture();
  await runSetupEnv({
    environment: {
      MAILPIT_SMTP_PORT: '11025',
      MINIO_API_PORT: '19000',
      POSTGRES_PORT: '15432',
      REDIS_PORT: '16379'
    },
    rootDirectory
  });
  const api = await readValues(rootDirectory, 'apps/api/.env');

  assert.equal(api.get('DATABASE_URL'), 'postgresql://postgres:postgres@localhost:15432/classroomio');
  assert.equal(api.get('REDIS_URL'), 'redis://localhost:16379');
  assert.equal(api.get('OBJECT_STORAGE_ENDPOINT'), 'http://localhost:19000');
  assert.equal(api.get('SMTP_PORT'), '11025');
});

test('uses a configured public host while keeping the private dashboard API URL local', async () => {
  const rootDirectory = await createFixture();
  await runSetupEnv({ environment: { DEV_PUBLIC_HOST: '100.127.1.234' }, rootDirectory });
  const api = await readValues(rootDirectory, 'apps/api/.env');
  const dashboard = await readValues(rootDirectory, 'apps/dashboard/.env');

  assert.equal(api.get('PUBLIC_SERVER_URL'), 'http://100.127.1.234:3002');
  assert.equal(api.get('DASHBOARD_ORIGIN'), 'http://100.127.1.234:5173');
  assert.equal(api.get('TRUSTED_ORIGINS'), 'http://100.127.1.234:5173,http://localhost:5173');
  assert.equal(dashboard.get('PUBLIC_SERVER_URL'), 'http://100.127.1.234:3002');
  assert.equal(dashboard.get('PRIVATE_SERVER_URL'), 'http://localhost:3002');
});

test('uses standard HTTPS without adding port 443 to the dashboard origin', async () => {
  const rootDirectory = await createFixture();
  await runSetupEnv({
    environment: {
      DEV_API_PUBLIC_PORT: '3002',
      DEV_DASHBOARD_PUBLIC_PORT: '443',
      DEV_PUBLIC_HOST: 'server.example.ts.net',
      DEV_PUBLIC_PROTOCOL: 'https',
      DEV_REDIRECT_HOST: '100.127.1.234:5173'
    },
    rootDirectory
  });
  const api = await readValues(rootDirectory, 'apps/api/.env');
  const dashboard = await readValues(rootDirectory, 'apps/dashboard/.env');

  assert.equal(api.get('PUBLIC_SERVER_URL'), 'https://server.example.ts.net:3002');
  assert.equal(api.get('DASHBOARD_ORIGIN'), 'https://server.example.ts.net');
  assert.equal(dashboard.get('PUBLIC_SERVER_URL'), 'https://server.example.ts.net:3002');
  assert.equal(dashboard.get('VITE_ALLOWED_HOST'), 'server.example.ts.net');
  assert.equal(dashboard.get('VITE_CANONICAL_ORIGIN'), 'https://server.example.ts.net');
  assert.equal(dashboard.get('VITE_REDIRECT_HOST'), '100.127.1.234:5173');
});
