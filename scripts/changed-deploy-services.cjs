#!/usr/bin/env node
/**
 * Which of the deployed services a range of commits actually touched.
 * CommonJS format for 100% compatibility across all Node.js runner versions (Node 10 to Node 24).
 */

const ALL = ['api', 'dashboard', 'jobs', 'admin'];

const OWNED = [
  { prefix: 'apps/api/', service: 'api' },
  { prefix: 'apps/dashboard/', service: 'dashboard' },
  { prefix: 'apps/jobs/', service: 'jobs' },
  { prefix: 'apps/admin/', service: 'admin' },
  { prefix: 'packages/ui/', service: 'dashboard' },
  { prefix: 'docker/Dockerfile.api', service: 'api' },
  { prefix: 'docker/Dockerfile.dashboard', service: 'dashboard' },
  { prefix: 'docker/Dockerfile.jobs', service: 'jobs' },
  { prefix: 'docker/Dockerfile.admin', service: 'admin' }
];

const IGNORED = [
  'docs/',
  'plans/',
  'apps/docs/',
  'apps/website/',
  'apps/course-app/',
  'apps/embeds/',
  '.vscode/',
  '.github/ISSUE_TEMPLATE/'
];

function changedDeployServices(files) {
  const considered = files.filter(function (file) {
    return (
      file.length > 0 &&
      !IGNORED.some(function (prefix) {
        return file.startsWith(prefix);
      })
    );
  });

  if (considered.length === 0) return [];

  const services = new Set();

  for (const file of considered) {
    const owner = OWNED.find(function (entry) {
      return file.startsWith(entry.prefix);
    });

    if (!owner) return ALL;

    services.add(owner.service);
  }

  return ALL.filter(function (service) {
    return services.has(service);
  });
}

if (
  require.main === module ||
  (process.argv[1] &&
    (process.argv[1].endsWith('changed-deploy-services.js') || process.argv[1].endsWith('changed-deploy-services.cjs')))
) {
  const files = process.argv.slice(2);
  for (const service of changedDeployServices(files)) {
    console.log(service);
  }
}

module.exports = { changedDeployServices };
