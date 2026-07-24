import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import * as schema from '@db/schema';
import { db } from '@db/drizzle';

/** The settings table holds exactly one row, pinned to this id. */
const SETTINGS_ROW_ID = 1;

export type GatewaySettingsRow = typeof schema.aiGatewaySettings.$inferSelect;
export type GatewayOrgPolicyRow = typeof schema.aiGatewayOrgPolicy.$inferSelect;

/**
 * Reads the singleton settings row.
 *
 * Returns null when unconfigured; callers normalize that into safe disabled
 * defaults rather than treating it as an error, so a fresh install still serves
 * AI traffic over the official API path.
 */
export async function getGatewaySettingsRow(): Promise<GatewaySettingsRow | null> {
  try {
    const [row] = await db
      .select()
      .from(schema.aiGatewaySettings)
      .where(eq(schema.aiGatewaySettings.id, SETTINGS_ROW_ID))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('getGatewaySettingsRow error:', error);
    throw new Error('Failed to read AI gateway settings');
  }
}

/** Creates or updates the singleton settings row. */
export async function upsertGatewaySettingsRow(
  values: Partial<typeof schema.aiGatewaySettings.$inferInsert>
): Promise<GatewaySettingsRow> {
  try {
    const [row] = await db
      .insert(schema.aiGatewaySettings)
      .values({ ...values, id: SETTINGS_ROW_ID })
      .onConflictDoUpdate({
        target: schema.aiGatewaySettings.id,
        set: { ...values, updatedAt: new Date().toISOString() }
      })
      .returning();

    return row;
  } catch (error) {
    console.error('upsertGatewaySettingsRow error:', error);
    throw new Error('Failed to update AI gateway settings');
  }
}

/** Reads one org's policy row. A missing row means "inherit global defaults". */
export async function getGatewayOrgPolicyRow(orgId: string): Promise<GatewayOrgPolicyRow | null> {
  try {
    const [row] = await db
      .select()
      .from(schema.aiGatewayOrgPolicy)
      .where(eq(schema.aiGatewayOrgPolicy.orgId, orgId))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('getGatewayOrgPolicyRow error:', error);
    throw new Error('Failed to read AI gateway org policy');
  }
}

/** Lists every customised org policy. Orgs on pure defaults have no row. */
export async function listGatewayOrgPolicyRows(): Promise<GatewayOrgPolicyRow[]> {
  try {
    return await db.select().from(schema.aiGatewayOrgPolicy);
  } catch (error) {
    console.error('listGatewayOrgPolicyRows error:', error);
    throw new Error('Failed to list AI gateway org policies');
  }
}

/** Creates or updates one org's policy row. */
export async function upsertGatewayOrgPolicyRow(
  orgId: string,
  values: Partial<typeof schema.aiGatewayOrgPolicy.$inferInsert>
): Promise<GatewayOrgPolicyRow> {
  try {
    const [row] = await db
      .insert(schema.aiGatewayOrgPolicy)
      .values({ ...values, orgId })
      .onConflictDoUpdate({
        target: schema.aiGatewayOrgPolicy.orgId,
        set: { ...values, updatedAt: new Date().toISOString() }
      })
      .returning();

    return row;
  } catch (error) {
    console.error('upsertGatewayOrgPolicyRow error:', error);
    throw new Error('Failed to update AI gateway org policy');
  }
}

/**
 * Sums cost units consumed through the gateway inside a trailing window.
 *
 * The window is a rolling interval rather than a calendar period, so capacity
 * recovers continuously as old consumption ages out. Usage is keyed on the
 * *requested* model id — the proxy answers `gpt-5.4-mini` with a dated snapshot
 * id, which would never match the allowlist.
 */
export async function getGatewayWindowConsumption(params: {
  models: string[];
  windowMinutes: number;
  orgId?: string;
}): Promise<number> {
  if (params.models.length === 0) return 0;

  try {
    const conditions = [
      inArray(schema.aiTokenUsage.model, params.models),
      gte(schema.aiTokenUsage.createdAt, sql`NOW() - (${params.windowMinutes} || ' minutes')::interval`)
    ];

    if (params.orgId) {
      conditions.push(eq(schema.aiTokenUsage.orgId, params.orgId));
    }

    const [row] = await db
      .select({
        total: sql<number>`COALESCE(SUM(COALESCE(${schema.aiTokenUsage.costUnits}, ${schema.aiTokenUsage.promptTokens} + ${schema.aiTokenUsage.completionTokens})), 0)`
      })
      .from(schema.aiTokenUsage)
      .where(and(...conditions));

    return Number(row?.total ?? 0);
  } catch (error) {
    console.error('getGatewayWindowConsumption error:', error);
    throw new Error('Failed to read AI gateway window consumption');
  }
}

/** Per-org consumption inside a trailing window, heaviest first. */
export async function getGatewayWindowConsumptionByOrg(params: {
  models: string[];
  windowMinutes: number;
}): Promise<Array<{ orgId: string; units: number }>> {
  if (params.models.length === 0) return [];

  try {
    const rows = await db
      .select({
        orgId: schema.aiTokenUsage.orgId,
        units: sql<number>`COALESCE(SUM(COALESCE(${schema.aiTokenUsage.costUnits}, ${schema.aiTokenUsage.promptTokens} + ${schema.aiTokenUsage.completionTokens})), 0)`
      })
      .from(schema.aiTokenUsage)
      .where(
        and(
          inArray(schema.aiTokenUsage.model, params.models),
          gte(schema.aiTokenUsage.createdAt, sql`NOW() - (${params.windowMinutes} || ' minutes')::interval`)
        )
      )
      .groupBy(schema.aiTokenUsage.orgId);

    return rows
      .map((row) => ({ orgId: String(row.orgId), units: Number(row.units) }))
      .sort((a, b) => b.units - a.units);
  } catch (error) {
    console.error('getGatewayWindowConsumptionByOrg error:', error);
    throw new Error('Failed to read AI gateway consumption by org');
  }
}
