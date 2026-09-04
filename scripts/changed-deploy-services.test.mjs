import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { changedDeployServices } from './changed-deploy-services.mjs';

/**
 * Written against `node:test` rather than vitest on purpose: this file lives outside every
 * workspace package, so a vitest suite here belongs to no project and is run by nobody. It
 * said it was a test for a week without ever having executed.
 */

/**
 * Being wrong in one direction costs a rebuild. Being wrong in the other ships a dashboard
 * against an API that does not have the endpoint it calls, into a live exam. Every case here
 * is about which way the doubt falls.
 */
describe('changedDeployServices', () => {
  it('narrows an admin-panel change to the dashboard alone', () => {
    // The case this exists for: a candidate mid-exam must not have the API restarted under
    // them because somebody changed a colour on the teacher's screen.
    assert.deepEqual(changedDeployServices(['apps/dashboard/src/routes/(app)/courses/x/+page.svelte']), ['dashboard']);
  });

  it('keeps the migration runner with the API, which shares its image', () => {
    assert.deepEqual(changedDeployServices(['apps/api/src/routes/exam/exam.ts']), ['api']);
  });

  it('rebuilds everything when a shared package changes', () => {
    // `packages/db` reaches the API, the jobs worker and the dashboard's types. Deciding
    // otherwise is a guess, and the guess is only safe until somebody adds an import.
    assert.deepEqual(changedDeployServices(['packages/db/src/schema.ts']), ['api', 'dashboard', 'jobs']);
  });

  it('rebuilds everything when the lockfile changes', () => {
    assert.deepEqual(changedDeployServices(['pnpm-lock.yaml']), ['api', 'dashboard', 'jobs']);
  });

  it("narrows a service's own Dockerfile to that service", () => {
    // It builds one image. Rebuilding the other two costs ten minutes and changes nothing.
    assert.deepEqual(changedDeployServices(['docker/Dockerfile.dashboard']), ['dashboard']);
    assert.deepEqual(changedDeployServices(['docker/Dockerfile.api']), ['api']);
  });

  it('still rebuilds everything for the rest of docker/', () => {
    // The compose file, the shared ignore rules and the entrypoints reach all three.
    assert.deepEqual(changedDeployServices(['docker/production/docker-compose.yaml']), ['api', 'dashboard', 'jobs']);
    assert.deepEqual(changedDeployServices(['docker/.dockerignore']), ['api', 'dashboard', 'jobs']);
  });

  it('rebuilds everything for a path nobody has classified', () => {
    // The unknown path is the dangerous one, so it takes the blunt answer rather than none.
    assert.deepEqual(changedDeployServices(['some/new/thing.ts']), ['api', 'dashboard', 'jobs']);
  });

  it('takes the union when two apps changed together', () => {
    assert.deepEqual(changedDeployServices(['apps/api/src/index.ts', 'apps/dashboard/src/app.css']), [
      'api',
      'dashboard'
    ]);
  });

  it('returns nothing when only documentation changed', () => {
    assert.deepEqual(changedDeployServices(['docs/a.md', 'plans/b.md']), []);
  });

  it('does not let an ignored path hide a real one', () => {
    assert.deepEqual(changedDeployServices(['docs/a.md', 'apps/api/src/index.ts']), ['api']);
  });

  it('always reports in a fixed order, so a caller can compare the list', () => {
    assert.deepEqual(changedDeployServices(['apps/jobs/x.ts', 'apps/api/y.ts']), ['api', 'jobs']);
  });
});
