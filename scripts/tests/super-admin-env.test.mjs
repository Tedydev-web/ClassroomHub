import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync('docker/production/docker-compose.yaml', 'utf8');

/**
 * The API container's environment is a whitelist, not an `env_file`, so a value
 * present in the host's environment file simply does not exist inside the
 * container unless it is named here.
 *
 * `SUPER_ADMIN_PASSWORD` was set on the host and missing from the list, so the
 * operator console's every call answered `503 Super admin API is not configured`
 * — a gate that reads as broken configuration rather than as a wrong password.
 */
test('the API container is given the super-admin gate', () => {
  assert.match(compose, /SUPER_ADMIN_PASSWORD: \$\{SUPER_ADMIN_PASSWORD:-\}/);
});
