import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildQueueOptions } from './defaults';
import { QUEUE_NAMES } from './names';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Comments describe the mistake this file exists to catch, so they must not count as it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Regression: every queue in this repository must carry its defaults.
 *
 * Two of them did not. A worker process cannot use the shared `getQueue`, because
 * BullMQ blocks on a Worker's own connection, so both reached for `new Queue(name,
 * { connection })` directly — and in doing so dropped `defaultJobOptions`, which is
 * the only thing that removes a job once it has finished.
 *
 * Nothing was noisy about it. Redis simply grew: 453,000 completed maintenance jobs
 * and 477,000 keys of which five had any expiry, against a 1.56 GB ceiling with
 * `noeviction` — a queue on course to refuse writes rather than shed history, on a
 * deployment whose exam imports, emails and media all pass through it.
 *
 * The source check is deliberate. A unit test on `buildQueueOptions` would have
 * passed throughout: the defaults were never wrong, they were bypassed. What has to
 * be checked is that nobody builds a queue around them.
 */
test('no worker builds a Queue directly', () => {
  const sources = [
    'apps/jobs/src/workers/maintenance.ts',
    'apps/jobs/src/workers/notifications.ts',
    'apps/jobs/src/workers/media.ts',
    'apps/jobs/src/workers/transcribe.ts'
  ];

  for (const relative of sources) {
    let source: string;

    try {
      source = withoutComments(readFileSync(join(repoRoot, relative), 'utf8'));
    } catch {
      // A worker that no longer exists is not a failure; the ones that do are checked.
      continue;
    }

    assert.equal(
      (source.match(/new Queue\(/g) ?? []).length,
      0,
      `${relative} builds a Queue directly; use createQueueOnConnection so it keeps its defaults`
    );
  }
});

test('the factory builds every queue through buildQueueOptions', () => {
  const source = withoutComments(readFileSync(join(repoRoot, 'packages/jobs/src/queues/factories.ts'), 'utf8'));
  const constructions = (source.match(/new Queue\(/g) ?? []).length;
  const withDefaults = (source.match(/buildQueueOptions\(/g) ?? []).length;

  assert.ok(constructions > 0, 'the factory should be the place that builds queues');
  assert.ok(
    withDefaults >= constructions,
    `factories.ts builds ${constructions} queues but only ${withDefaults} go through buildQueueOptions`
  );
});

test('every queue has a rule for removing a finished job', () => {
  for (const name of Object.values(QUEUE_NAMES)) {
    const { defaultJobOptions } = buildQueueOptions(name);

    assert.ok(defaultJobOptions?.removeOnComplete, `${name} keeps completed jobs forever`);
    assert.ok(defaultJobOptions?.removeOnFail, `${name} keeps failed jobs forever`);
  }
});

test('a caller-supplied connection does not displace the defaults', () => {
  const options = buildQueueOptions(QUEUE_NAMES.maintenance, { connection: { host: 'localhost', port: 6379 } });

  assert.deepEqual(options.connection, { host: 'localhost', port: 6379 });
  assert.ok(options.defaultJobOptions?.removeOnComplete);
});
