import { randomUUID } from 'node:crypto';

import { config } from 'dotenv';
import { describe, expect, it } from 'vitest';

config();

/**
 * Covers the gateway queries that cannot be unit-tested because their behavior
 * lives in SQL: rolling-window arithmetic, the requested-model filter, and the
 * status grouping admission control depends on.
 *
 * Gated behind RUN_DB_INTEGRATION=1, matching the existing DB integration tests.
 */
const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

describe.runIf(runDatabaseIntegration)('gateway settings and consumption queries', () => {
  it('reads and writes the singleton settings row', async () => {
    const [queries] = await Promise.all([import('@cio/db/queries/agent')]);

    const before = await queries.getGatewaySettingsRow();

    const written = await queries.upsertGatewaySettingsRow({
      sliceRounds: 7,
      globalConcurrency: 2
    });

    expect(written.sliceRounds).toBe(7);
    expect(written.globalConcurrency).toBe(2);
    // Singleton: the upsert must update in place, never append a second row.
    expect(written.id).toBe(1);

    const readBack = await queries.getGatewaySettingsRow();
    expect(readBack?.sliceRounds).toBe(7);

    // Restore whatever the deployment had configured.
    await queries.upsertGatewaySettingsRow({
      sliceRounds: before?.sliceRounds ?? 3,
      globalConcurrency: before?.globalConcurrency ?? 1
    });
  });

  it('sums only allowlisted models inside the trailing window', async () => {
    const [{ db }, schema, queries] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('@cio/db/queries/agent')
    ]);

    const [org] = await db.select({ id: schema.organization.id }).from(schema.organization).limit(1);
    if (!org) return;

    const [course] = await db.select({ id: schema.course.id }).from(schema.course).limit(1);
    const [profileRow] = await db.select({ id: schema.profile.id }).from(schema.profile).limit(1);
    if (!course || !profileRow) return;

    const gatewayModel = `test-gateway-model-${randomUUID().slice(0, 8)}`;
    const otherModel = `test-other-model-${randomUUID().slice(0, 8)}`;

    const inserted = await db
      .insert(schema.aiTokenUsage)
      .values([
        {
          orgId: org.id,
          userId: profileRow.id,
          courseId: course.id,
          promptTokens: 100,
          completionTokens: 50,
          costUnits: 600,
          model: gatewayModel
        },
        {
          // Same window, different model: must not be counted.
          orgId: org.id,
          userId: profileRow.id,
          courseId: course.id,
          promptTokens: 100,
          completionTokens: 50,
          costUnits: 9_999,
          model: otherModel
        },
        {
          // Allowlisted model but outside the trailing window: must not be counted.
          orgId: org.id,
          userId: profileRow.id,
          courseId: course.id,
          promptTokens: 100,
          completionTokens: 50,
          costUnits: 7_777,
          model: gatewayModel,
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
        }
      ])
      .returning({ id: schema.aiTokenUsage.id });

    try {
      const scoped = await queries.getGatewayWindowConsumption({
        models: [gatewayModel],
        windowMinutes: 60,
        orgId: org.id
      });

      expect(scoped).toBe(600);

      const global = await queries.getGatewayWindowConsumption({
        models: [gatewayModel],
        windowMinutes: 60
      });

      expect(global).toBeGreaterThanOrEqual(600);

      // A wider window picks up the older row too.
      const wide = await queries.getGatewayWindowConsumption({
        models: [gatewayModel],
        windowMinutes: 7 * 24 * 60,
        orgId: org.id
      });

      expect(wide).toBe(600 + 7_777);

      const byOrg = await queries.getGatewayWindowConsumptionByOrg({
        models: [gatewayModel],
        windowMinutes: 60
      });

      expect(byOrg.find((row) => row.orgId === org.id)?.units).toBe(600);

      // An empty model list must short-circuit rather than summing everything.
      expect(await queries.getGatewayWindowConsumption({ models: [], windowMinutes: 60 })).toBe(0);
      expect(await queries.getGatewayWindowConsumptionByOrg({ models: [], windowMinutes: 60 })).toEqual([]);
    } finally {
      const { inArray } = await import('drizzle-orm');
      await db.delete(schema.aiTokenUsage).where(
        inArray(
          schema.aiTokenUsage.id,
          inserted.map((row) => row.id)
        )
      );
    }
  });

  it('creates an org policy lazily and updates it in place', async () => {
    const [{ db }, schema, queries] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('@cio/db/queries/agent')
    ]);

    const [org] = await db.select({ id: schema.organization.id }).from(schema.organization).limit(1);
    if (!org) return;

    const existing = await queries.getGatewayOrgPolicyRow(org.id);

    const created = await queries.upsertGatewayOrgPolicyRow(org.id, { priorityWeight: 5 });
    expect(created.priorityWeight).toBe(5);

    const updated = await queries.upsertGatewayOrgPolicyRow(org.id, { priorityWeight: 2 });
    expect(updated.priorityWeight).toBe(2);
    // Unique on org_id: an update must not create a second row.
    expect(updated.id).toBe(created.id);

    const listed = await queries.listGatewayOrgPolicyRows();
    expect(listed.some((row) => row.orgId === org.id)).toBe(true);

    if (existing) {
      await queries.upsertGatewayOrgPolicyRow(org.id, { priorityWeight: existing.priorityWeight });
    } else {
      const { eq } = await import('drizzle-orm');
      await db.delete(schema.aiGatewayOrgPolicy).where(eq(schema.aiGatewayOrgPolicy.orgId, org.id));
    }
  });

  it('counts running and queued runs separately for admission control', async () => {
    const [{ db }, schema, queries] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('@cio/db/queries/agent')
    ]);

    const [org] = await db.select({ id: schema.organization.id }).from(schema.organization).limit(1);
    if (!org) return;

    const counts = await queries.countOrgAgentRunsByState(org.id);

    expect(typeof counts.active).toBe('number');
    expect(typeof counts.queued).toBe('number');
    expect(counts.active).toBeGreaterThanOrEqual(0);
    expect(counts.queued).toBeGreaterThanOrEqual(0);

    const runs = await queries.listAllAgentRuns({ limit: 5 });
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeLessThanOrEqual(5);

    // A status filter must narrow rather than widen the result set.
    const filtered = await queries.listAllAgentRuns({ statuses: ['running'], limit: 50 });
    expect(filtered.every((run) => run.status === 'running')).toBe(true);
  });
});
