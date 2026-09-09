import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/deploy-production.yml', 'utf8');

/**
 * A failed `compose up` must not leave the site with nothing running.
 *
 * Pinning the stack's subnet made Compose replace the network. Every running
 * container still referred to the old one by id, so each failed to start with
 * `network <id> not found`, the deploy stopped at that step, and production
 * served 502 from zero containers until someone recreated them by hand.
 */
test('the deploy recreates containers when Compose cannot start the stack', () => {
  assert.match(workflow, /compose_up --force-recreate/, 'no recovery path after a failed compose up');

  const guarded = /if ! compose_up; then[\s\S]{0,400}?compose_up --force-recreate/.test(workflow);
  assert.ok(guarded, 'the retry must run only when the first attempt failed');
});
