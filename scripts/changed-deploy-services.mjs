#!/usr/bin/env node
/**
 * Which of the deployed services a range of commits actually touched.
 *
 * Every deploy rebuilt and restarted all three, because the compose file gave them one
 * shared image tag. A change to a colour in the admin panel therefore restarted the API in
 * the middle of an exam — the one process a candidate's autosaves, activity reports and
 * submission all go through.
 *
 * The rule is deliberately blunt in the safe direction. An app is narrowed to itself only
 * when the whole diff lives inside it; anything shared — a package, the lockfile, a
 * Dockerfile, this workflow — rebuilds everything. Guessing that a change to `packages/db`
 * only affects one image is how a dashboard ships against an API that does not have the
 * endpoint it calls, and the cost of being wrong is far higher than the cost of a rebuild.
 *
 * Usage: node scripts/changed-deploy-services.mjs <file...>
 * Prints one service per line: api, dashboard, jobs.
 */

/** Everything that is deployed. Also the answer whenever a change is not clearly local. */
const ALL = ['api', 'dashboard', 'jobs'];

/**
 * Paths that belong to exactly one image.
 *
 * `apps/api` also owns the migration runner, which shares the API image and so shares its
 * tag: a service pinned to a tag nothing published is a deploy that fails at the pull.
 */
const OWNED = [
  { prefix: 'apps/api/', service: 'api' },
  { prefix: 'apps/dashboard/', service: 'dashboard' },
  { prefix: 'apps/jobs/', service: 'jobs' }
];

/**
 * Paths that change nothing that is deployed.
 *
 * Documentation, the other apps in this monorepo, and files that exist only for a developer.
 * Listed rather than inferred: a path nobody has thought about should rebuild everything,
 * not be quietly skipped.
 */
const IGNORED = [
  'docs/',
  'plans/',
  'apps/docs/',
  'apps/website/',
  'apps/admin/',
  'apps/course-app/',
  'apps/embeds/',
  '.vscode/',
  '.github/ISSUE_TEMPLATE/'
];

export function changedDeployServices(files) {
  const considered = files.filter((file) => file.length > 0 && !IGNORED.some((prefix) => file.startsWith(prefix)));

  // Nothing deployable changed. The caller decides whether that means "deploy nothing" or
  // "this was a docs commit"; it is not this script's business to guess.
  if (considered.length === 0) return [];

  const services = new Set();

  for (const file of considered) {
    const owner = OWNED.find((entry) => file.startsWith(entry.prefix));

    // Shared, or unrecognised. Either way every image is rebuilt: the blunt answer is the
    // safe one, and the sharp one is only safe until somebody adds a dependency.
    if (!owner) return ALL;

    services.add(owner.service);
  }

  return ALL.filter((service) => services.has(service));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const files = process.argv.slice(2);

  for (const service of changedDeployServices(files)) {
    console.log(service);
  }
}
