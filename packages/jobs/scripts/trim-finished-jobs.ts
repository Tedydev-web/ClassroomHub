/**
 * Remove the finished jobs that accumulated while the scheduler queues carried no
 * `removeOnComplete`.
 *
 * `removeOnComplete` applies to a job as it finishes, so fixing the queues cannot
 * reach what is already stored. Production held 453,000 completed and 21,700 failed
 * maintenance jobs — 477,000 Redis keys against a 1.56 GB ceiling set to
 * `noeviction`, which refuses writes rather than shedding history.
 *
 * Deliberately not one Lua script over the whole set. Lua runs atomically, so a
 * single pass deleting 475,000 keys holds Redis for as long as it takes, and every
 * request the site makes waits behind it. `Queue.clean` is bounded per call, which
 * turns the same work into short pauses — and it knows the queue's own data model,
 * where a hand-written DELETE over `bull:<queue>:<id>` guesses at it.
 *
 * Only `completed` and `failed` are touched. A waiting, active or delayed job is
 * work that has not happened yet.
 *
 * Usage: pnpm --filter @cio/jobs exec tsx scripts/trim-finished-jobs.ts [--dry-run]
 */
import { Queue } from 'bullmq';

import { createRedisConnection } from '../src/connection';
import { QUEUE_NAMES } from '../src/queues/names';

/** Small enough that a single call stays well under a second on a live instance. */
const BATCH = 1_000;

/** Everything finished before now. The queues keep their own retention from here on. */
const GRACE_MS = 0;

const dryRun = process.argv.includes('--dry-run');

async function trim(queueName: string, connection: ReturnType<typeof createRedisConnection>): Promise<void> {
  const queue = new Queue(queueName, { connection });

  try {
    for (const state of ['completed', 'failed'] as const) {
      const before = await queue.getJobCountByTypes(state);

      if (before === 0) {
        console.log(`${queueName}/${state}: nothing to remove`);
        continue;
      }

      if (dryRun) {
        console.log(`${queueName}/${state}: would remove ${before}`);
        continue;
      }

      let removed = 0;

      // Until a pass removes nothing: `clean` returns the ids it took, so an empty
      // return is the only reliable end, not a count computed up front.
      for (;;) {
        const batch = await queue.clean(GRACE_MS, BATCH, state);
        if (batch.length === 0) break;

        removed += batch.length;
        if (removed % 50_000 < BATCH) console.log(`${queueName}/${state}: ${removed}/${before}`);
      }

      console.log(`${queueName}/${state}: removed ${removed}, ${await queue.getJobCountByTypes(state)} left`);
    }
  } finally {
    await queue.close();
  }
}

async function main(): Promise<void> {
  const connection = createRedisConnection();

  try {
    for (const queueName of Object.values(QUEUE_NAMES)) {
      await trim(queueName, connection);
    }
  } finally {
    await connection.quit();
  }
}

await main();
