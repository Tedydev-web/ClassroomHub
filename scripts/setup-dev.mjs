import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPlaceholderSecret,
  parseEnvValues,
  pathExists,
  readEnvDocument,
  runCommandCheck,
  upsertManagedEnvValues,
  writeEnvDocument
} from './dev-environment-utils.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_KEYS = new Set([
  'BETTER_AUTH_SECRET',
  'PRIVATE_SERVER_KEY',
  'WEBHOOK_ENCRYPTION_KEY',
  'HLS_SIGNING_SECRET'
]);
const DEV_ENV_FILE = '.env.dev';
const DEV_ENV_EXAMPLE = '.env.dev.example';

const ENV_TARGETS = [
  { example: 'apps/api/.env.example', target: 'apps/api/.env' },
  { example: 'apps/dashboard/.env.example', target: 'apps/dashboard/.env' },
  { example: 'apps/jobs/.env.example', target: 'apps/jobs/.env' },
  { example: 'packages/db/.env.example', target: 'packages/db/.env' }
];

export function generateSecret() {
  return randomBytes(48).toString('base64url');
}

export async function loadDevEnvironment(rootDirectory, environment = process.env) {
  const targetPath = path.join(rootDirectory, DEV_ENV_FILE);
  if (!(await pathExists(targetPath))) {
    const example = await readFile(path.join(rootDirectory, DEV_ENV_EXAMPLE), 'utf8');
    await writeEnvDocument(targetPath, example);
  }

  const document = await readEnvDocument(targetPath);
  return { ...process.env, ...Object.fromEntries(parseEnvValues(document.content)), ...environment };
}

export function resolveSetupMode(args) {
  const modeArgument = args.find((argument) => argument.startsWith('--mode='));
  if (!modeArgument) return { explicit: false, mode: 'cloud' };

  const mode = modeArgument.slice('--mode='.length);
  if (!['cloud', 'self-hosted'].includes(mode)) {
    throw new Error(`Unsupported setup mode: ${mode}`);
  }

  return { explicit: true, mode };
}

function managedValue(value, secret = false) {
  return { secret, value };
}

export function buildManagedEnvMaps({
  betterAuthSecret,
  environment = process.env,
  hlsSigningSecret,
  mode,
  privateServerKey,
  webhookEncryptionKey
}) {
  const isSelfHosted = String(mode === 'self-hosted');
  const dashboardLocalPort = environment.DEV_DASHBOARD_LOCAL_PORT ?? '8000';
  const apiLocalPort = environment.DEV_API_LOCAL_PORT ?? '8001';
  const postgresPort = environment.POSTGRES_PORT ?? '8002';
  const redisPort = environment.REDIS_PORT ?? '8003';
  const minioApiPort = environment.MINIO_API_PORT ?? '8004';
  const mailpitSmtpPort = environment.MAILPIT_SMTP_PORT ?? '8006';
  const publicHost = environment.DEV_PUBLIC_HOST ?? 'localhost';
  const apiPublicHost = environment.DEV_API_PUBLIC_HOST ?? publicHost;
  const publicProtocol = environment.DEV_PUBLIC_PROTOCOL ?? 'http';
  const apiPublicPort = environment.DEV_API_PUBLIC_PORT ?? apiLocalPort;
  const dashboardPublicPort = environment.DEV_DASHBOARD_PUBLIC_PORT ?? dashboardLocalPort;
  const apiPortSuffix =
    (publicProtocol === 'https' && apiPublicPort === '443') || (publicProtocol === 'http' && apiPublicPort === '80')
      ? ''
      : `:${apiPublicPort}`;
  const apiPublicUrl = `${publicProtocol}://${apiPublicHost}${apiPortSuffix}`;
  const dashboardPortSuffix =
    (publicProtocol === 'https' && dashboardPublicPort === '443') ||
    (publicProtocol === 'http' && dashboardPublicPort === '80')
      ? ''
      : `:${dashboardPublicPort}`;
  const dashboardPublicUrl = `${publicProtocol}://${publicHost}${dashboardPortSuffix}`;
  const redirectHost = environment.DEV_REDIRECT_HOST ?? '';
  const databaseUrl = `postgresql://postgres:postgres@localhost:${postgresPort}/classroomio`;
  const redisUrl = `redis://localhost:${redisPort}`;
  const minioEndpoint = `http://localhost:${minioApiPort}`;
  const objectStoragePublicUrl = environment.DEV_OBJECT_STORAGE_PUBLIC_URL ?? minioEndpoint;
  const objectStorage = new Map([
    ['OBJECT_STORAGE_ENDPOINT', managedValue(minioEndpoint)],
    ['OBJECT_STORAGE_PUBLIC_ENDPOINT', managedValue(objectStoragePublicUrl)],
    ['OBJECT_STORAGE_ACCESS_KEY_ID', managedValue('classroomio')],
    ['OBJECT_STORAGE_SECRET_ACCESS_KEY', managedValue('classroomio-dev-only')],
    ['OBJECT_STORAGE_FORCE_PATH_STYLE', managedValue('true')],
    ['OBJECT_STORAGE_BUCKET_VIDEOS', managedValue('videos')],
    ['OBJECT_STORAGE_BUCKET_DOCUMENTS', managedValue('documents')],
    ['OBJECT_STORAGE_BUCKET_MEDIA', managedValue('media')],
    ['OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL', managedValue(`${objectStoragePublicUrl}/media`)]
  ]);
  const smtp = new Map([
    ['SMTP_HOST', managedValue('127.0.0.1')],
    ['SMTP_PORT', managedValue(mailpitSmtpPort)],
    ['SMTP_SECURE', managedValue('false')],
    ['SMTP_REQUIRE_TLS', managedValue('false')],
    ['SMTP_USER', managedValue('')],
    ['SMTP_PASSWORD', managedValue('')],
    ['SMTP_SENDER', managedValue('ClassroomHub <noreply@localhost>')]
  ]);

  return new Map([
    [
      'apps/api/.env',
      new Map([
        ['PORT', managedValue(apiLocalPort)],
        ['DATABASE_URL', managedValue(databaseUrl)],
        ['REDIS_URL', managedValue(redisUrl)],
        ['PUBLIC_SERVER_URL', managedValue(apiPublicUrl)],
        ['TRUSTED_ORIGINS', managedValue(`${dashboardPublicUrl},http://localhost:${dashboardLocalPort}`)],
        ['DASHBOARD_ORIGIN', managedValue(dashboardPublicUrl)],
        ['PRIVATE_SERVER_KEY', managedValue(privateServerKey, true)],
        ['BETTER_AUTH_SECRET', managedValue(betterAuthSecret, true)],
        ['WEBHOOK_ENCRYPTION_KEY', managedValue(webhookEncryptionKey, true)],
        ['HLS_SIGNING_SECRET', managedValue(hlsSigningSecret, true)],
        ['PUBLIC_IS_SELFHOSTED', managedValue(isSelfHosted)],
        ['PUBLIC_IS_SELF_OWNED', managedValue('true')],
        ...objectStorage,
        ...smtp
      ])
    ],
    [
      'apps/dashboard/.env',
      new Map([
        ['PUBLIC_SERVER_URL', managedValue(apiPublicUrl)],
        ['PRIVATE_SERVER_URL', managedValue(`http://localhost:${apiLocalPort}`)],
        ['PRIVATE_SERVER_KEY', managedValue(privateServerKey, true)],
        ['PUBLIC_IS_SELFHOSTED', managedValue(isSelfHosted)],
        ['PUBLIC_IS_SELF_OWNED', managedValue('true')],
        ['PRIVATE_APP_HOST', managedValue(environment.DEV_PRIVATE_APP_HOST ?? 'localhost')],
        ['PRIVATE_APP_SUBDOMAINS', managedValue('app')],
        ['VITE_ALLOWED_HOST', managedValue(publicHost)],
        ['VITE_CANONICAL_ORIGIN', managedValue(dashboardPublicUrl)],
        ['VITE_REDIRECT_HOST', managedValue(redirectHost)]
      ])
    ],
    [
      'apps/jobs/.env',
      new Map([
        ['DATABASE_URL', managedValue(databaseUrl)],
        ['REDIS_URL', managedValue(redisUrl)],
        ['WEBHOOK_ENCRYPTION_KEY', managedValue(webhookEncryptionKey, true)],
        ['PUBLIC_IS_SELFHOSTED', managedValue(isSelfHosted)],
        ['PUBLIC_IS_SELF_OWNED', managedValue('true')],
        ...objectStorage,
        ...smtp
      ])
    ],
    ['packages/db/.env', new Map([['DATABASE_URL', managedValue(databaseUrl)]])]
  ]);
}

function findExistingSecret(documents, key) {
  for (const document of documents.values()) {
    const value = parseEnvValues(document.content).get(key);
    if (value && value.length >= 32 && !isPlaceholderSecret(value)) return value;
  }

  return null;
}

export async function runSetupEnv(options = {}) {
  const rootDirectory = options.rootDirectory ?? REPOSITORY_ROOT;
  const environment = await loadDevEnvironment(rootDirectory, options.environment);
  const args = options.args ?? [];
  const mode = resolveSetupMode(args);
  const applyLocalDefaults = args.includes('--apply-local-defaults');
  const documents = new Map();

  for (const target of ENV_TARGETS) {
    const targetPath = path.join(rootDirectory, target.target);
    const exists = await pathExists(targetPath);
    let document = await readEnvDocument(targetPath);
    if (!exists) {
      document = { content: await readFile(path.join(rootDirectory, target.example), 'utf8'), exists, newline: '\n' };
    } else {
      document.exists = exists;
    }
    documents.set(target.target, document);
  }

  const privateServerKey = findExistingSecret(documents, 'PRIVATE_SERVER_KEY') ?? generateSecret();
  const betterAuthSecret = findExistingSecret(documents, 'BETTER_AUTH_SECRET') ?? generateSecret();
  const webhookEncryptionKey = findExistingSecret(documents, 'WEBHOOK_ENCRYPTION_KEY') ?? generateSecret();
  const hlsSigningSecret = findExistingSecret(documents, 'HLS_SIGNING_SECRET') ?? generateSecret();
  const managedMaps = buildManagedEnvMaps({
    betterAuthSecret,
    environment,
    hlsSigningSecret,
    mode: mode.mode,
    privateServerKey,
    webhookEncryptionKey
  });
  const conflicts = [];

  for (const [target, managedValues] of managedMaps) {
    const currentValues = parseEnvValues(documents.get(target).content);
    for (const [key, definition] of managedValues) {
      const currentValue = currentValues.get(key);
      const modeMayChange = mode.explicit && key === 'PUBLIC_IS_SELFHOSTED';
      if (
        currentValue !== undefined &&
        currentValue !== '' &&
        currentValue !== definition.value &&
        !(definition.secret && isPlaceholderSecret(currentValue)) &&
        documents.get(target).exists &&
        !applyLocalDefaults &&
        !modeMayChange
      ) {
        conflicts.push({ key, target });
      }
    }
  }

  if (conflicts.length > 0) {
    const summary = conflicts.map(({ key, target }) => `${target}: ${key}`).join(', ');
    throw new Error(
      `Managed local values conflict (${summary}). Re-run with --apply-local-defaults to replace non-secret values.`
    );
  }

  const changedFiles = [];
  for (const [target, managedValues] of managedMaps) {
    const replaceKeys = new Set();
    if (applyLocalDefaults || !documents.get(target).exists) {
      for (const [key, definition] of managedValues) if (!definition.secret) replaceKeys.add(key);
    }
    if (mode.explicit) replaceKeys.add('PUBLIC_IS_SELFHOSTED');

    const updated = upsertManagedEnvValues(documents.get(target).content, managedValues, { replaceKeys });
    if (updated.content !== documents.get(target).content || !documents.get(target).exists) {
      await writeEnvDocument(path.join(rootDirectory, target), updated.content);
      changedFiles.push(target);
    }
  }

  return { changedFiles, mode: mode.mode };
}

export function runPnpmStep(args, options = {}) {
  const pnpmEntryPoint = options.pnpmEntryPoint ?? process.env.npm_execpath;
  if (!pnpmEntryPoint) throw new Error('pnpm entry point is unavailable. Run setup through pnpm setup:dev.');

  const result = runCommandCheck(process.execPath, [pnpmEntryPoint, ...args], {
    cwd: options.rootDirectory ?? REPOSITORY_ROOT,
    env: options.environment ?? process.env
  });
  if (!result.ok) throw new Error(result.output || `pnpm ${args.join(' ')} failed`);

  return result;
}

export function runDockerComposeStep(args, options = {}) {
  const result = runCommandCheck(
    'docker',
    ['compose', '--env-file', DEV_ENV_FILE, '-f', 'docker-compose.dev.yaml', ...args],
    {
      cwd: options.rootDirectory ?? REPOSITORY_ROOT,
      env: options.environment ?? process.env
    }
  );
  if (!result.ok) throw new Error(result.output || `docker compose ${args.join(' ')} failed`);

  return result;
}

export async function runSetupDev(options = {}) {
  const rootDirectory = options.rootDirectory ?? REPOSITORY_ROOT;
  const environment = await loadDevEnvironment(rootDirectory, options.environment);
  const dockerCheck = runCommandCheck('docker', ['info'], { cwd: rootDirectory, env: environment });
  if (!dockerCheck.ok)
    throw new Error('Docker Engine is not reachable. Start Docker Desktop before running setup:dev.');

  runPnpmStep(['install', '--frozen-lockfile'], { environment, rootDirectory });
  await runSetupEnv({ args: options.args ?? [], environment, rootDirectory });
  runDockerComposeStep(['up', '-d', '--wait', '--wait-timeout', '180', 'postgres', 'redis', 'minio', 'mailpit'], {
    environment,
    rootDirectory
  });
  runDockerComposeStep(['run', '--rm', 'minio-init'], { environment, rootDirectory });
  runPnpmStep(['--filter', '@cio/db', 'db:setup:seed'], { environment, rootDirectory });
  runPnpmStep(['--filter', '@cio/api...', '--filter', '@cio/dashboard...', 'build'], { environment, rootDirectory });

  return { ready: true };
}

async function main() {
  const command = process.argv[2];
  if (!['dev', 'env'].includes(command))
    throw new Error('Usage: node scripts/setup-dev.mjs <dev|env> [--mode=cloud|self-hosted] [--apply-local-defaults]');

  if (command === 'env') {
    const result = await runSetupEnv({ args: process.argv.slice(3) });
    console.log(`Local environment ready in ${result.mode} mode. Updated ${result.changedFiles.length} file(s).`);
    return;
  }

  await runSetupDev({ args: process.argv.slice(3) });
  console.log('ClassroomHub local development environment is ready.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
