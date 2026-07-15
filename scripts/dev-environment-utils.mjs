import { spawnSync } from 'node:child_process';
import { access, lstat, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Socket } from 'node:net';

const SEMVER_PATTERN = /^(?:v)?(\d+\.\d+\.\d+)$/;

export function parseExpectedNodeVersion(value) {
  const match = String(value).trim().match(SEMVER_PATTERN);

  if (!match) {
    throw new Error(`Invalid Node version declaration: ${String(value).trim() || '<empty>'}`);
  }

  return match[1];
}

export function parsePackageManagerVersion(value) {
  const match = String(value)
    .trim()
    .match(/^pnpm@(\d+\.\d+\.\d+)(?:\+.+)?$/);

  if (!match) {
    throw new Error(`Invalid pnpm packageManager declaration: ${String(value).trim() || '<empty>'}`);
  }

  return match[1];
}

/**
 * Reads the active pnpm version from `npm_config_user_agent`, which pnpm sets on every
 * invocation (`pnpm run`, `pnpm exec`, ...). This avoids spawning `pnpm` as a subprocess:
 * on Windows, pnpm ships as a `.CMD` shim that Node cannot execute with `shell: false`
 * (ENOENT), and invoking it through `cmd.exe` reopens shell-metacharacter injection even
 * with an argv array (`cmd.exe` re-parses the joined command line itself).
 */
export function parseUserAgentPnpmVersion(userAgent) {
  const match = String(userAgent ?? '').match(/pnpm\/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

export function runCommandCheck(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: false,
    windowsHide: true
  });
  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';
  const output = stdout || stderr;

  return {
    available: !result.error || result.error.code !== 'ENOENT',
    error: result.error?.message ?? null,
    ok: result.status === 0,
    output,
    status: result.status
  };
}

export async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findMissingPaths(filePaths) {
  const pathChecks = await Promise.all(filePaths.map(async (filePath) => [filePath, await pathExists(filePath)]));

  return pathChecks.filter(([, exists]) => !exists).map(([filePath]) => filePath);
}

export async function inspectEnvFileSafely(filePath, options = {}) {
  const requiredKeys = options.requiredKeys ?? [];

  if (!(await pathExists(filePath))) {
    return {
      exists: false,
      deploymentOwnership: null,
      missingKeys: [...requiredKeys].sort(),
      presentKeys: [],
      productMode: null
    };
  }

  const content = await readFile(filePath, 'utf8');
  const values = parseEnvValues(content);
  const presentKeys = new Set(values.keys());
  const selfHostedValue = values.get('PUBLIC_IS_SELFHOSTED')?.toLowerCase();
  const selfOwnedValue = values.get('PUBLIC_IS_SELF_OWNED')?.toLowerCase();
  const productMode = selfHostedValue === 'true' ? 'self-hosted' : selfHostedValue === 'false' ? 'cloud' : null;
  const deploymentOwnership =
    selfOwnedValue === 'true' ? 'self-owned' : selfOwnedValue === 'false' ? 'upstream-managed' : null;

  return {
    deploymentOwnership,
    exists: true,
    missingKeys: requiredKeys.filter((key) => !presentKeys.has(key)).sort(),
    presentKeys: [...presentKeys].sort(),
    productMode
  };
}

export function resolveDeploymentSettingConsistency(...modes) {
  const configuredModes = modes.filter(Boolean);

  if (configuredModes.length === 0) {
    return { blocking: false, mode: null, status: 'unknown' };
  }

  if (configuredModes.length !== modes.length) {
    return { blocking: true, mode: null, status: 'incomplete' };
  }

  if (new Set(configuredModes).size !== 1) {
    return { blocking: true, mode: null, status: 'mismatch' };
  }

  return { blocking: false, mode: configuredModes[0], status: 'ready' };
}

export function probePort(port, host = '127.0.0.1', timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (available, error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ available, error, host, port });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(false));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => {
      const available = error.code === 'ECONNREFUSED';
      finish(available, available ? null : (error.code ?? error.message));
    });
    socket.connect(port, host);
  });
}

export async function probeHttp(url, timeoutMs = 3000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false, status: null };
  }
}

export function hasBlockingDiagnostics(diagnostics) {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export async function readEnvDocument(filePath) {
  const content = (await pathExists(filePath)) ? await readFile(filePath, 'utf8') : '';
  const newline = content.includes('\r\n') ? '\r\n' : '\n';

  return { content, newline };
}

export function parseEnvValues(content) {
  const values = new Map();

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    values.set(key, rawValue.trim().replace(/^(?:"(.*)"|'(.*)')$/, '$1$2'));
  }

  return values;
}

export function isPlaceholderSecret(value) {
  const normalizedValue = String(value ?? '')
    .trim()
    .toLowerCase();

  return (
    normalizedValue.length < 32 ||
    normalizedValue === '' ||
    normalizedValue === 'changeme' ||
    normalizedValue === 'replace-me' ||
    normalizedValue === 'your-secret-here' ||
    normalizedValue.startsWith('your-')
  );
}

export function upsertManagedEnvValues(content, managedValues, options = {}) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const appliedKeys = new Set();

  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match) return line;

    const [, indentation, key, separator, rawValue] = match;
    if (!managedValues.has(key)) return line;

    const currentValue = rawValue.trim().replace(/^(?:"(.*)"|'(.*)')$/, '$1$2');
    const managedValue = managedValues.get(key);
    const shouldReplace =
      currentValue === '' ||
      (managedValue.secret && isPlaceholderSecret(currentValue)) ||
      options.replaceKeys?.has(key);

    if (!shouldReplace) return line;

    appliedKeys.add(key);
    return `${indentation}${key}${separator}"${managedValue.value}"`;
  });

  for (const [key, managedValue] of managedValues) {
    if (appliedKeys.has(key) || parseEnvValues(nextLines.join(newline)).has(key)) continue;

    if (nextLines.length > 0 && nextLines.at(-1) !== '') nextLines.push('');
    nextLines.push(`${key}="${managedValue.value}"`);
    appliedKeys.add(key);
  }

  return { appliedKeys: [...appliedKeys].sort(), content: nextLines.join(newline) };
}

export async function writeEnvDocument(filePath, content) {
  if (await pathExists(filePath)) {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) throw new Error(`Refusing to write symlinked env file: ${filePath}`);
  }

  await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
}
