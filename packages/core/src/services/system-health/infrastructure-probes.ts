import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { db, sql } from '@cio/db/drizzle';
import { QUEUE_NAMES, getQueue, isRedisConfigured } from '@cio/jobs';

import { checkStorageHealth } from './storage-health';
import type { HealthProbe, ProbeOutcome } from './types';

/** A queue this deep has stopped draining, whatever the reason. */
const QUEUE_BACKLOG_WARN = 100;

/**
 * Deploy does not run migrations, so code that expects a column can reach production before
 * the column does. Comparing the applied ledger with the shipped journal catches exactly that.
 */
async function readJournalEntryCount(): Promise<number | null> {
  try {
    const dbEntry = createRequire(import.meta.url).resolve('@cio/db');
    const journalPath = path.resolve(path.dirname(dbEntry), '../src/migrations/meta/_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries?: unknown[] };

    return Array.isArray(journal.entries) ? journal.entries.length : null;
  } catch {
    return null;
  }
}

async function probeDatabase(): Promise<ProbeOutcome> {
  await db.execute(sql`select 1`);

  const rows = await db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`);
  const applied = Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0);
  const shipped = await readJournalEntryCount();

  if (shipped === null)
    return { status: 'ok', detail: `Connected; ${applied} migrations applied (journal not shipped)` };
  if (applied < shipped) {
    return { status: 'fail', detail: `${shipped - applied} migration(s) not applied (${applied}/${shipped})` };
  }

  return { status: 'ok', detail: `Connected; migrations up to date (${applied}/${shipped})` };
}

async function probeRedis(): Promise<ProbeOutcome> {
  if (!isRedisConfigured()) return { status: 'unconfigured', detail: 'REDIS_URL is not set' };

  const client = await getQueue(QUEUE_NAMES.maintenance).client;
  const reply = await client.ping();

  return reply === 'PONG' ? { status: 'ok', detail: 'PONG' } : { status: 'fail', detail: `Unexpected reply: ${reply}` };
}

async function probeQueues(): Promise<ProbeOutcome> {
  if (!isRedisConfigured()) return { status: 'unconfigured', detail: 'REDIS_URL is not set' };

  const names = Object.values(QUEUE_NAMES);
  const counts = await Promise.all(
    names.map(async (name) => {
      const jobCounts = await getQueue(name).getJobCounts('waiting', 'failed');
      return { name, waiting: jobCounts.waiting ?? 0, failed: jobCounts.failed ?? 0 };
    })
  );
  const failed = counts.filter((queue) => queue.failed > 0);
  const backlogged = counts.filter((queue) => queue.waiting >= QUEUE_BACKLOG_WARN);

  if (failed.length === 0 && backlogged.length === 0) {
    return { status: 'ok', detail: `${names.length} queues, no failed jobs, no backlog` };
  }

  const parts = [
    ...failed.map((queue) => `${queue.name}: ${queue.failed} failed`),
    ...backlogged.map((queue) => `${queue.name}: ${queue.waiting} waiting`)
  ];

  return { status: 'warn', detail: parts.join('; ') };
}

/** Workers register themselves on Redis, so this answers "is anything consuming jobs?". */
async function probeWorkers(): Promise<ProbeOutcome> {
  if (!isRedisConfigured()) return { status: 'unconfigured', detail: 'REDIS_URL is not set' };

  const watched = [QUEUE_NAMES.emails, QUEUE_NAMES.maintenance, QUEUE_NAMES.notifications, QUEUE_NAMES.media];
  const workers = await Promise.all(
    watched.map(async (name) => ({ name, count: await getQueue(name).getWorkersCount() }))
  );
  const idle = workers.filter((worker) => worker.count === 0).map((worker) => worker.name);

  return idle.length === 0
    ? { status: 'ok', detail: `Workers connected on ${watched.join(', ')}` }
    : { status: 'fail', detail: `No worker connected for: ${idle.join(', ')}` };
}

async function probeStorage(): Promise<ProbeOutcome> {
  const health = await checkStorageHealth();
  const failed = health.buckets.filter((bucket) => !bucket.ok);

  return failed.length === 0
    ? { status: 'ok', detail: `Write, read and delete succeeded on ${health.buckets.length} buckets` }
    : { status: 'fail', detail: failed.map((bucket) => `${bucket.bucket}: ${bucket.error ?? 'failed'}`).join('; ') };
}

export function getInfrastructureProbes(): HealthProbe[] {
  return [
    { id: 'database', group: 'infrastructure', label: 'PostgreSQL + migrations', run: probeDatabase },
    { id: 'redis', group: 'infrastructure', label: 'Redis', run: probeRedis },
    { id: 'queues', group: 'infrastructure', label: 'Job queues', run: probeQueues },
    { id: 'workers', group: 'infrastructure', label: 'Background workers', run: probeWorkers },
    { id: 'storage', group: 'storage', label: 'Object storage buckets', run: probeStorage }
  ];
}
