#!/usr/bin/env node
/**
 * Direct Deployment CLI for ClassroomHub.
 *
 * Allows building and deploying services directly from the local developer machine
 * or secondary server without consuming GitHub Actions monthly quota minutes.
 *
 * Usage:
 *   node scripts/deploy-direct.mjs [--all] [--service=api,dashboard] [--dry-run]
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { changedDeployServices } from './changed-deploy-services.mjs';

const ALL_SERVICES = ['dashboard', 'api', 'jobs', 'admin'];
const REGISTRY = 'ghcr.io/tedydev-web';

function run(cmd, options = {}) {
  console.log(`\x1b[36m$ ${cmd}\x1b[0m`);
  if (options.dryRun) return '';
  return execSync(cmd, { stdio: 'inherit', ...options });
}

function getOutput(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes('--all');
  const isDryRun = args.includes('--dry-run');
  const serviceArg = args.find((arg) => arg.startsWith('--service='));

  console.log('\x1b[32m=== ClassroomHub Direct Deployment CLI ===\x1b[0m');

  const currentSha = getOutput('git rev-parse --short=9 HEAD');
  const fullSha = getOutput('git rev-parse HEAD');

  if (!fullSha) {
    console.error('\x1b[31mError: Not a valid git repository or cannot read HEAD.\x1b[0m');
    process.exit(1);
  }

  console.log(`Target Commit: ${currentSha} (${fullSha})`);

  let targetServices = [];

  if (serviceArg) {
    targetServices = serviceArg
      .split('=')[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (isAll) {
    targetServices = ALL_SERVICES;
  } else {
    // Detect changes between origin/main (or HEAD~1) and current HEAD
    let diffRange = 'HEAD~1..HEAD';
    const upstreamCommit = getOutput('git rev-parse origin/main 2>/dev/null || true');
    if (upstreamCommit && upstreamCommit !== fullSha) {
      diffRange = `${upstreamCommit}..HEAD`;
    }

    const changedFiles = getOutput(`git diff --name-only ${diffRange}`).split('\n').filter(Boolean);
    console.log(`Detected ${changedFiles.length} changed files in range ${diffRange}`);
    targetServices = changedDeployServices(changedFiles);
  }

  if (targetServices.length === 0) {
    console.log('\x1b[33mNo deployable services changed. Nothing to build or deploy.\x1b[0m');
    return;
  }

  console.log(`Services to build & deploy: \x1b[35m${targetServices.join(', ')}\x1b[0m`);

  // Build each service locally using Docker BuildKit
  for (const service of targetServices) {
    const dockerfile = `./docker/Dockerfile.${service}`;
    const imageTag = `${REGISTRY}/classroom-${service}:sha-${fullSha}`;

    console.log(`\n\x1b[34m---> Building ${service} [${imageTag}]...\x1b[0m`);

    let buildArgs = '';
    if (service === 'dashboard') {
      buildArgs = '--build-arg PUBLIC_IS_SELFHOSTED=false --build-arg PUBLIC_IS_SELF_OWNED=true';
    }

    // Read turbo team if present
    let turboTeamArg = '';
    if (existsSync('.turbo/config.json')) {
      try {
        const turboConfig = JSON.parse(readFileSync('.turbo/config.json', 'utf8'));
        if (turboConfig.teamId) {
          turboTeamArg = `--build-arg TURBO_TEAM=${turboConfig.teamId}`;
        }
      } catch {
        // Ignore turbo config parse errors
      }
    }

    const buildCmd = [
      'docker buildx build',
      `--file ${dockerfile}`,
      `--tag ${imageTag}`,
      buildArgs,
      turboTeamArg,
      isDryRun ? '' : '--load',
      '.'
    ]
      .filter(Boolean)
      .join(' ');

    run(buildCmd, { dryRun: isDryRun });
    console.log(`\x1b[32m✔ Successfully built ${service}\x1b[0m`);
  }

  console.log('\n\x1b[32m=== All requested images built successfully! ===\x1b[0m');
  console.log('\nTo deploy to production without GitHub Actions:');
  console.log('1. Push images to GHCR (or stream directly to host):');
  for (const service of targetServices) {
    console.log(`   docker push ${REGISTRY}/classroom-${service}:sha-${fullSha}`);
  }
  console.log('2. On the production host, update containers with:');
  console.log(
    `   ssh ubuntu@146.190.106.182 "cd /home/tedydev && CLASSROOM_${targetServices[0].toUpperCase()}_TAG=sha-${fullSha} docker compose -f docker/production/docker-compose.yaml up -d --no-build"`
  );
}

main().catch((err) => {
  console.error('\x1b[31mFatal error:\x1b[0m', err.message);
  process.exit(1);
});
