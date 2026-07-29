import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findMissingPaths,
  hasBlockingDiagnostics,
  inspectEnvFileSafely,
  parseExpectedNodeVersion,
  parsePackageManagerVersion,
  parseTcpPort,
  parseUserAgentPnpmVersion,
  probeHttp,
  probePort,
  resolveDeploymentSettingConsistency,
  runCommandCheck
} from '../dev-environment-utils.mjs';

test('parses repository Node and pnpm version declarations', () => {
  assert.equal(parseExpectedNodeVersion('v22.23.1\n'), '22.23.1');
  assert.equal(
    parsePackageManagerVersion('pnpm@10.19.0+sha512.c9fc7236e92adf5c8af42fd5bf1612df99c2ceb62f27047032f4720b33f8eac'),
    '10.19.0'
  );
});

test('accepts only valid TCP ports', () => {
  assert.equal(parseTcpPort('8000'), 8000);
  assert.equal(parseTcpPort('65535'), 65535);
  assert.equal(parseTcpPort('0'), null);
  assert.equal(parseTcpPort('800L'), null);
  assert.equal(parseTcpPort(undefined), null);
});

test('parses pnpm version from the npm_config_user_agent env var without spawning a process', () => {
  assert.equal(parseUserAgentPnpmVersion('pnpm/10.19.0 npm/? node/v22.23.1 win32 x64'), '10.19.0');
  assert.equal(parseUserAgentPnpmVersion('npm/10.2.0 node/v22.23.1 win32 x64'), null);
  assert.equal(parseUserAgentPnpmVersion(undefined), null);
});

test('runs executable checks without a shell', () => {
  const result = runCommandCheck(process.execPath, ['--version']);

  assert.equal(result.available, true);
  assert.match(result.output, /^v\d+\.\d+\.\d+/);
});

test('reports missing build outputs without exposing file contents', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cio-build-outputs-'));
  const existingPath = path.join(directory, 'existing.js');
  const missingPath = path.join(directory, 'missing.js');

  try {
    await writeFile(existingPath, '');
    assert.deepEqual(await findMissingPaths([existingPath, missingPath]), [missingPath]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('inspects env metadata without returning secret values', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cio-doctor-'));
  const envPath = path.join(directory, '.env');

  try {
    await writeFile(
      envPath,
      [
        '# local fixture',
        'DATABASE_URL="postgresql://secret-user:secret-password@localhost:8002/classroomhub"',
        'PRIVATE_SERVER_KEY="super-secret-value"',
        'PUBLIC_IS_SELFHOSTED=false',
        'PUBLIC_IS_SELF_OWNED=true'
      ].join('\n')
    );

    const metadata = await inspectEnvFileSafely(envPath, {
      requiredKeys: ['DATABASE_URL', 'PRIVATE_SERVER_KEY', 'REDIS_URL']
    });
    const serialized = JSON.stringify(metadata);

    assert.equal(metadata.exists, true);
    assert.deepEqual(metadata.missingKeys, ['REDIS_URL']);
    assert.equal(metadata.deploymentOwnership, 'self-owned');
    assert.equal(metadata.productMode, 'cloud');
    assert.equal(serialized.includes('secret-password'), false);
    assert.equal(serialized.includes('super-secret-value'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('detects mismatched product modes', () => {
  assert.deepEqual(resolveDeploymentSettingConsistency('cloud', 'self-hosted'), {
    blocking: true,
    mode: null,
    status: 'mismatch'
  });
  assert.deepEqual(resolveDeploymentSettingConsistency('cloud', 'cloud'), {
    blocking: false,
    mode: 'cloud',
    status: 'ready'
  });
  assert.deepEqual(resolveDeploymentSettingConsistency('cloud', null), {
    blocking: true,
    mode: null,
    status: 'incomplete'
  });
  assert.deepEqual(resolveDeploymentSettingConsistency('self-owned', 'self-owned', 'self-owned'), {
    blocking: false,
    mode: 'self-owned',
    status: 'ready'
  });
  assert.deepEqual(resolveDeploymentSettingConsistency('self-owned', 'upstream-managed', 'self-owned'), {
    blocking: true,
    mode: null,
    status: 'mismatch'
  });
});

test('detects occupied and available ports', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const occupied = await probePort(address.port);
    assert.equal(occupied.available, false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  const available = await probePort(address.port);
  assert.equal(available.available, true);
});

test('probes an HTTP application instead of accepting any port listener', async () => {
  const server = createHttpServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('OK');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const healthy = await probeHttp(`http://127.0.0.1:${address.port}`);
    assert.deepEqual(healthy, { ok: true, status: 200 });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('reports blocking diagnostics by severity', () => {
  assert.equal(hasBlockingDiagnostics([{ severity: 'warning' }, { severity: 'info' }]), false);
  assert.equal(hasBlockingDiagnostics([{ severity: 'warning' }, { severity: 'error' }]), true);
});

test('runs the doctor CLI and returns a structured summary', () => {
  const doctorPath = path.resolve('scripts/dev-doctor.mjs');
  const result = runCommandCheck(process.execPath, [doctorPath]);

  assert.equal(result.available, true);
  assert.ok(result.status === 0 || result.status === 1);
  assert.match(result.output, /ClassroomHub development doctor/);
  assert.equal(result.output.includes('super-secret-value'), false);
});

test('blocks when pnpm does not match the pinned version', () => {
  const doctorPath = path.resolve('scripts/dev-doctor.mjs');
  const environment = { ...process.env, npm_config_user_agent: 'pnpm/9.0.0 npm/? node/v22.23.1 win32 x64' };
  const result = runCommandCheck(process.execPath, [doctorPath], { env: environment });

  assert.equal(result.status, 1);
  assert.match(result.output, /\[BLOCK\] pnpm 9\.0\.0 is active/);
});

test('local development entrypoint exposes help without starting services', () => {
  const scriptPath = path.resolve('scripts/start-development.sh');
  const result = runCommandCheck('bash', [scriptPath, '--help']);

  assert.equal(result.status, 0);
  assert.match(result.output, /Usage: pnpm dev:local/);
});
