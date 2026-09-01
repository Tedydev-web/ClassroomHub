import { describe, expect, it } from 'vitest';

import { changedDeployServices } from './changed-deploy-services.mjs';

/**
 * Being wrong in one direction costs a rebuild. Being wrong in the other ships a dashboard
 * against an API that does not have the endpoint it calls, into a live exam. Every case here
 * is about which way the doubt falls.
 */
describe('changedDeployServices', () => {
  it('narrows an admin-panel change to the dashboard alone', () => {
    // The case this exists for: a candidate mid-exam must not have the API restarted under
    // them because somebody changed a colour on the teacher's screen.
    expect(changedDeployServices(['apps/dashboard/src/routes/(app)/courses/x/+page.svelte'])).toEqual(['dashboard']);
  });

  it('keeps the migration runner with the API, which shares its image', () => {
    expect(changedDeployServices(['apps/api/src/routes/exam/exam.ts'])).toEqual(['api']);
  });

  it('rebuilds everything when a shared package changes', () => {
    // `packages/db` reaches the API, the jobs worker and the dashboard's types. Deciding
    // otherwise is a guess, and the guess is only safe until somebody adds an import.
    expect(changedDeployServices(['packages/db/src/schema.ts'])).toEqual(['api', 'dashboard', 'jobs']);
  });

  it('rebuilds everything when the lockfile or a Dockerfile changes', () => {
    expect(changedDeployServices(['pnpm-lock.yaml'])).toEqual(['api', 'dashboard', 'jobs']);
    expect(changedDeployServices(['docker/Dockerfile.api'])).toEqual(['api', 'dashboard', 'jobs']);
  });

  it('rebuilds everything for a path nobody has classified', () => {
    // The unknown path is the dangerous one, so it takes the blunt answer rather than none.
    expect(changedDeployServices(['some/new/thing.ts'])).toEqual(['api', 'dashboard', 'jobs']);
  });

  it('takes the union when two apps changed together', () => {
    expect(changedDeployServices(['apps/api/src/index.ts', 'apps/dashboard/src/app.css'])).toEqual([
      'api',
      'dashboard'
    ]);
  });

  it('returns nothing when only documentation changed', () => {
    expect(changedDeployServices(['docs/a.md', 'plans/b.md'])).toEqual([]);
  });

  it('does not let an ignored path hide a real one', () => {
    expect(changedDeployServices(['docs/a.md', 'apps/api/src/index.ts'])).toEqual(['api']);
  });

  it('always reports in a fixed order, so a caller can compare the list', () => {
    expect(changedDeployServices(['apps/jobs/x.ts', 'apps/api/y.ts'])).toEqual(['api', 'jobs']);
  });
});
