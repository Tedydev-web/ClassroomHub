import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  findMissingPaths,
  hasBlockingDiagnostics,
  inspectEnvFileSafely,
  parseEnvValues,
  parseExpectedNodeVersion,
  parsePackageManagerVersion,
  parseUserAgentPnpmVersion,
  pathExists,
  probeHttp,
  probePort,
  resolveDeploymentSettingConsistency,
  runCommandCheck
} from './dev-environment-utils.mjs';

const CORE_BUILD_OUTPUTS = [
  'apps/api/dist/index.js',
  'packages/ai-assistant/dist/index.js',
  'packages/analytics/dist/index.js',
  'packages/certificates/dist/index.js',
  'packages/core/dist/index.js',
  'packages/db/dist/index.js',
  'packages/email/dist/index.js',
  'packages/jobs/dist/index.js',
  'packages/question-types/dist/index.js',
  'packages/utils/dist/index.js'
];

const REQUIRED_API_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'PUBLIC_SERVER_URL',
  'TRUSTED_ORIGINS',
  'BETTER_AUTH_SECRET',
  'PRIVATE_SERVER_KEY',
  'PUBLIC_IS_SELFHOSTED',
  'PUBLIC_IS_SELF_OWNED'
];

const REQUIRED_DASHBOARD_ENV_KEYS = [
  'PUBLIC_SERVER_URL',
  'PRIVATE_SERVER_URL',
  'PRIVATE_SERVER_KEY',
  'PUBLIC_IS_SELFHOSTED',
  'PUBLIC_IS_SELF_OWNED'
];

const REQUIRED_JOBS_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'WEBHOOK_ENCRYPTION_KEY',
  'PUBLIC_IS_SELFHOSTED',
  'PUBLIC_IS_SELF_OWNED'
];

function addDiagnostic(diagnostics, severity, message) {
  diagnostics.push({ message, severity });
}

async function checkNodeVersion(diagnostics) {
  const nvmrcRaw = await readFile(path.resolve('.nvmrc'), 'utf8');
  const expectedVersion = parseExpectedNodeVersion(nvmrcRaw);
  const actualVersion = process.version.replace(/^v/, '');

  if (actualVersion !== expectedVersion) {
    addDiagnostic(
      diagnostics,
      'error',
      `Node ${actualVersion} is active but this repository requires Node ${expectedVersion} (see .nvmrc). Run: nvm use ${expectedVersion}`
    );
    return;
  }

  addDiagnostic(diagnostics, 'info', `Node ${actualVersion} matches .nvmrc.`);
}

async function checkPnpmVersion(diagnostics) {
  const packageJsonRaw = await readFile(path.resolve('package.json'), 'utf8');
  const packageJson = JSON.parse(packageJsonRaw);
  const expectedVersion = parsePackageManagerVersion(packageJson.packageManager);
  const actualVersion = parseUserAgentPnpmVersion(process.env.npm_config_user_agent);

  if (!actualVersion) {
    addDiagnostic(
      diagnostics,
      'warning',
      'Could not determine the active pnpm version (run this command as "pnpm dev:doctor" so pnpm sets npm_config_user_agent).'
    );
    return;
  }

  if (actualVersion !== expectedVersion) {
    addDiagnostic(
      diagnostics,
      'error',
      `pnpm ${actualVersion} is active but package.json pins pnpm ${expectedVersion}. Run: corepack prepare pnpm@${expectedVersion} --activate`
    );
    return;
  }

  addDiagnostic(diagnostics, 'info', `pnpm ${actualVersion} matches packageManager.`);
}

function checkGit(diagnostics) {
  const result = runCommandCheck('git', ['--version']);

  if (!result.available) {
    addDiagnostic(diagnostics, 'error', 'git is not installed or not on PATH.');
    return;
  }

  addDiagnostic(diagnostics, 'info', result.output.trim());
}

function checkDockerToolchain(diagnostics) {
  const cliResult = runCommandCheck('docker', ['--version']);
  if (!cliResult.available) {
    addDiagnostic(
      diagnostics,
      'error',
      'Docker CLI is not installed or not on PATH. Install Docker Desktop before continuing.'
    );
    return;
  }
  addDiagnostic(diagnostics, 'info', cliResult.output.trim());

  const composeResult = runCommandCheck('docker', ['compose', 'version']);
  if (!composeResult.ok) {
    addDiagnostic(
      diagnostics,
      'error',
      'Docker Compose is unavailable. Update Docker Desktop to a version that bundles Compose v2.'
    );
  } else {
    addDiagnostic(diagnostics, 'info', composeResult.output.trim());
  }

  const engineResult = runCommandCheck('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (!engineResult.ok) {
    addDiagnostic(
      diagnostics,
      'error',
      'Docker Engine is not reachable. Start Docker Desktop, then re-run: pnpm dev:doctor'
    );
    return;
  }

  addDiagnostic(diagnostics, 'info', `Docker Engine ${engineResult.output.trim()} is reachable.`);
}

function checkMediaTooling(diagnostics) {
  for (const [label, binary] of [
    ['ffmpeg', 'ffmpeg'],
    ['ffprobe', 'ffprobe']
  ]) {
    const result = runCommandCheck(binary, ['-version']);

    if (!result.available) {
      addDiagnostic(
        diagnostics,
        'warning',
        `${label} is not installed or not on PATH. Media/thumbnail background jobs will fail until this is resolved; API and dashboard are unaffected.`
      );
      continue;
    }

    addDiagnostic(diagnostics, 'info', `${label} is available.`);
  }
}

async function checkPorts(diagnostics) {
  const devEnvPath = (await pathExists(path.resolve('.env.dev'))) ? '.env.dev' : '.env.dev.example';
  const devEnvironment = parseEnvValues(await readFile(path.resolve(devEnvPath), 'utf8'));
  const requiredPorts = [
    { port: Number(devEnvironment.get('DEV_API_LOCAL_PORT') ?? 8001), service: 'api' },
    { port: Number(devEnvironment.get('DEV_DASHBOARD_LOCAL_PORT') ?? 8000), service: 'dashboard' },
    { port: Number(devEnvironment.get('POSTGRES_PORT')), service: 'postgres' },
    { port: Number(devEnvironment.get('REDIS_PORT')), service: 'redis' },
    { port: Number(devEnvironment.get('MINIO_API_PORT')), service: 'minio (s3 api)' },
    { port: Number(devEnvironment.get('MINIO_CONSOLE_PORT')), service: 'minio (console)' },
    { port: Number(devEnvironment.get('MAILPIT_SMTP_PORT')), service: 'mailpit (smtp)' },
    { port: Number(devEnvironment.get('MAILPIT_UI_PORT')), service: 'mailpit (web ui)' }
  ];
  const composeResult = runCommandCheck('docker', [
    'compose',
    '--env-file',
    '.env.dev',
    '-f',
    'docker-compose.dev.yaml',
    'ps',
    '--format',
    'json'
  ]);
  const composePorts = new Set();

  if (composeResult.ok && composeResult.output) {
    try {
      const services = composeResult.output
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          const parsed = JSON.parse(line);
          return Array.isArray(parsed) ? parsed : [parsed];
        });
      for (const service of services) {
        if (service.State !== 'running') continue;
        for (const publisher of service.Publishers ?? []) composePorts.add(publisher.PublishedPort);
      }
    } catch {
      addDiagnostic(
        diagnostics,
        'warning',
        'Docker Compose status output could not be parsed; port ownership is unknown.'
      );
    }
  }

  for (const { port, service } of requiredPorts) {
    const probe = await probePort(port);

    if (!probe.available) {
      if (composePorts.has(port) || service === 'api' || service === 'dashboard') {
        addDiagnostic(diagnostics, 'info', `Port ${port} (${service}) is listening.`);
        continue;
      }

      addDiagnostic(
        diagnostics,
        'warning',
        `Port ${port} (${service}) is already in use. Free it or stop the conflicting process before starting local infrastructure.`
      );
    }
  }
}

async function checkWorkspaceDependencies(diagnostics) {
  const nodeModulesExists = await pathExists(path.resolve('node_modules'));

  if (!nodeModulesExists) {
    addDiagnostic(
      diagnostics,
      'error',
      'Workspace dependencies are not installed. Run: pnpm install --frozen-lockfile'
    );
    return;
  }

  addDiagnostic(diagnostics, 'info', 'Workspace dependencies are installed.');

  const missingOutputs = await findMissingPaths(CORE_BUILD_OUTPUTS);
  if (missingOutputs.length > 0) {
    addDiagnostic(
      diagnostics,
      'error',
      `Core workspace build outputs are missing (${missingOutputs.length}). Run: pnpm build`
    );
    return;
  }

  addDiagnostic(diagnostics, 'info', 'Core workspace build outputs are available.');
}

async function checkLocalApplications(diagnostics) {
  const devEnvPath = (await pathExists(path.resolve('.env.dev'))) ? '.env.dev' : '.env.dev.example';
  const devEnvironment = parseEnvValues(await readFile(path.resolve(devEnvPath), 'utf8'));
  const dashboardEnvPath = path.resolve('apps/dashboard/.env');
  if (!(await pathExists(dashboardEnvPath))) {
    return;
  }

  const dashboardEnvironment = parseEnvValues(await readFile(dashboardEnvPath, 'utf8'));
  const apiLocalPort = devEnvironment.get('DEV_API_LOCAL_PORT') ?? '8001';
  const dashboardLocalPort = devEnvironment.get('DEV_DASHBOARD_LOCAL_PORT') ?? '8000';
  const apiUrl = dashboardEnvironment.get('PRIVATE_SERVER_URL') ?? `http://127.0.0.1:${apiLocalPort}`;
  const applications = [
    { name: 'API', url: apiUrl },
    { name: 'Dashboard', url: `http://127.0.0.1:${dashboardLocalPort}` }
  ];

  for (const application of applications) {
    const probe = await probeHttp(application.url);
    if (!probe.ok) {
      addDiagnostic(
        diagnostics,
        'error',
        `${application.name} did not answer successfully at ${application.url}. Start the development process and retry.`
      );
      continue;
    }

    addDiagnostic(diagnostics, 'info', `${application.name} HTTP check passed at ${application.url}.`);
  }
}

async function checkEnvFilesAndProductMode(diagnostics) {
  const apiEnvPath = path.resolve('apps/api/.env');
  const dashboardEnvPath = path.resolve('apps/dashboard/.env');
  const jobsEnvPath = path.resolve('apps/jobs/.env');

  const apiEnv = await inspectEnvFileSafely(apiEnvPath, { requiredKeys: REQUIRED_API_ENV_KEYS });
  const dashboardEnv = await inspectEnvFileSafely(dashboardEnvPath, { requiredKeys: REQUIRED_DASHBOARD_ENV_KEYS });
  const jobsEnv = await inspectEnvFileSafely(jobsEnvPath, { requiredKeys: REQUIRED_JOBS_ENV_KEYS });

  if (!apiEnv.exists || !dashboardEnv.exists || !jobsEnv.exists) {
    addDiagnostic(
      diagnostics,
      'warning',
      'Local .env files are not fully set up yet. Run: pnpm setup:dev (or pnpm setup:env for a Docker-free bootstrap).'
    );
    return;
  }

  if (apiEnv.missingKeys.length > 0) {
    addDiagnostic(diagnostics, 'warning', `apps/api/.env is missing keys: ${apiEnv.missingKeys.join(', ')}.`);
  }

  if (dashboardEnv.missingKeys.length > 0) {
    addDiagnostic(
      diagnostics,
      'warning',
      `apps/dashboard/.env is missing keys: ${dashboardEnv.missingKeys.join(', ')}.`
    );
  }

  if (jobsEnv.missingKeys.length > 0) {
    addDiagnostic(diagnostics, 'warning', `apps/jobs/.env is missing keys: ${jobsEnv.missingKeys.join(', ')}.`);
  }

  const deploymentSettings = [
    {
      key: 'PUBLIC_IS_SELFHOSTED',
      values: [apiEnv.productMode, dashboardEnv.productMode, jobsEnv.productMode]
    },
    {
      key: 'PUBLIC_IS_SELF_OWNED',
      values: [apiEnv.deploymentOwnership, dashboardEnv.deploymentOwnership, jobsEnv.deploymentOwnership]
    }
  ];
  const [modeConsistency, ownershipConsistency] = deploymentSettings.map(({ key, values }) => {
    const consistency = resolveDeploymentSettingConsistency(...values);

    if (consistency.status === 'mismatch') {
      addDiagnostic(
        diagnostics,
        'error',
        `${key} differs across API, dashboard, and jobs env files. Set the same value in all three files, then restart the dev servers.`
      );
    } else if (consistency.status === 'incomplete') {
      addDiagnostic(diagnostics, 'warning', `${key} is not set in every API, dashboard, and jobs env file.`);
    }

    return consistency;
  });

  if (modeConsistency.blocking || ownershipConsistency.blocking) return;

  if (modeConsistency.status === 'ready' && ownershipConsistency.status === 'ready') {
    const topology = modeConsistency.mode === 'self-hosted' ? 'single-org' : 'multi-tenant';
    addDiagnostic(
      diagnostics,
      'info',
      `Deployment configuration agrees across API, dashboard, and jobs: topology=${topology}, ownership=${ownershipConsistency.mode}.`
    );
  }
}

async function runDoctor() {
  const diagnostics = [];

  await checkNodeVersion(diagnostics);
  await checkPnpmVersion(diagnostics);
  checkGit(diagnostics);
  checkDockerToolchain(diagnostics);
  checkMediaTooling(diagnostics);
  await checkPorts(diagnostics);
  await checkWorkspaceDependencies(diagnostics);
  await checkEnvFilesAndProductMode(diagnostics);
  await checkLocalApplications(diagnostics);

  console.log('Classroom development doctor');
  console.log('================================');

  for (const diagnostic of diagnostics) {
    const prefix = { error: '[BLOCK]', info: '[ OK ]', warning: '[WARN]' }[diagnostic.severity] ?? '[INFO]';
    console.log(`${prefix} ${diagnostic.message}`);
  }

  const blocking = hasBlockingDiagnostics(diagnostics);
  console.log('================================');
  console.log(blocking ? 'Result: BLOCKED — resolve the [BLOCK] items above before continuing.' : 'Result: READY');

  process.exitCode = blocking ? 1 : 0;
}

runDoctor().catch((error) => {
  console.error('pnpm dev:doctor failed unexpectedly:', error.message);
  process.exitCode = 1;
});
