import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '../drizzle';
import * as schema from '../schema';

/**
 * Removes exam attempts past their retention period.
 *
 * An attempt holds the declared name, class and candidate number of a minor, collected
 * through an endpoint with no authentication, alongside their answers, the record of how
 * those answers changed, a salted address hash and a user-agent string. All of it lives on
 * the attempt row, so removing the row removes the lot — there is nothing to chase.
 *
 * The case that would otherwise be missed: an exam with no working time and no closing
 * time leaves `expiresAt` null, so those attempts stay `in_progress` for ever and lazy
 * finalisation never touches them. They are pruned by age since they started, like the
 * rest.
 *
 *   pnpm --filter @cio/db exec tsx src/scripts/prune-exam-attempts.ts --days 180 --dry-run
 */

const DEFAULT_RETENTION_DAYS = 180;

function readNumberFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;

  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const days = readNumberFlag('days', DEFAULT_RETENTION_DAYS);
  const dryRun = process.argv.includes('--dry-run');
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Either it finished long enough ago, or it never had a clock and started long enough
  // ago. The second half is the one an obvious implementation forgets.
  const stale = and(
    or(
      lt(schema.examAttempt.submittedAt, cutoff),
      and(isNull(schema.examAttempt.submittedAt), lt(schema.examAttempt.startedAt, cutoff))
    )
  );

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.examAttempt)
    .where(stale);

  const total = counted?.count ?? 0;

  if (dryRun) {
    const [neverExpiring] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.examAttempt)
      .where(and(stale, isNull(schema.examAttempt.expiresAt), eq(schema.examAttempt.status, 'in_progress')));

    console.log(`Retention: ${days} days (cutoff ${cutoff})`);
    console.log(`Would remove ${total} attempt(s).`);
    console.log(`  of which ${neverExpiring?.count ?? 0} belong to untimed exams and would never finalise.`);
    return;
  }

  await db.delete(schema.examAttempt).where(stale);
  console.log(`Removed ${total} attempt(s) older than ${days} days.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('prune-exam-attempts failed:', error);
    process.exit(1);
  });
