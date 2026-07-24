import {
  getGatewayOrgPolicyRow,
  getGatewaySettingsRow,
  upsertGatewayOrgPolicyRow,
  upsertGatewaySettingsRow
} from '@cio/db/queries/agent';

import {
  normalizeGatewaySettings,
  resolveOrgLimits,
  type GatewayOrgPolicy,
  type GatewaySettings,
  type ResolvedOrgLimits
} from './gateway-settings';

/**
 * Settings are read on every admission decision, so a short-lived process cache
 * keeps that off the database hot path. The TTL is deliberately small: an
 * operator pausing the gateway during an incident must see it take effect
 * quickly, and writes call `invalidateGatewaySettingsCache()` for immediacy.
 */
const SETTINGS_CACHE_TTL_MS = 5_000;

let cachedSettings: GatewaySettings | null = null;
let cachedAt = 0;

function isCacheFresh(now: number): boolean {
  return cachedSettings !== null && now - cachedAt < SETTINGS_CACHE_TTL_MS;
}

/** Drops the cached settings so the next read hits the database. */
export function invalidateGatewaySettingsCache(): void {
  cachedSettings = null;
  cachedAt = 0;
}

/**
 * Returns current gateway settings, cached briefly.
 *
 * A read failure degrades to disabled defaults rather than propagating: losing
 * the config must not take down AI features that can still run on the official
 * API path.
 */
export async function getGatewaySettings(options?: { now?: number }): Promise<GatewaySettings> {
  const now = options?.now ?? Date.now();

  if (isCacheFresh(now)) {
    return cachedSettings as GatewaySettings;
  }

  try {
    const row = await getGatewaySettingsRow();
    cachedSettings = normalizeGatewaySettings(row as Partial<GatewaySettings> | null);
  } catch (error) {
    console.error('getGatewaySettings falling back to disabled defaults:', error);
    cachedSettings = normalizeGatewaySettings(null);
  }

  cachedAt = now;

  return cachedSettings;
}

/** Writes gateway settings and immediately invalidates the cache. */
export async function saveGatewaySettings(values: Record<string, unknown>): Promise<GatewaySettings> {
  const row = await upsertGatewaySettingsRow(values as never);
  invalidateGatewaySettingsCache();

  return normalizeGatewaySettings(row as unknown as Partial<GatewaySettings>);
}

/**
 * Resolves an org's effective limits by merging its policy row over the global
 * defaults. Org policy rows are not cached — they are read far less often than
 * settings and staleness there is harder to reason about.
 */
export async function getOrgGatewayLimits(orgId: string): Promise<ResolvedOrgLimits> {
  const settings = await getGatewaySettings();

  try {
    const policy = await getGatewayOrgPolicyRow(orgId);

    return resolveOrgLimits(settings, policy as GatewayOrgPolicy | null);
  } catch (error) {
    console.error('getOrgGatewayLimits falling back to defaults:', error);

    return resolveOrgLimits(settings, null);
  }
}

/** Writes one org's policy row. */
export async function saveOrgGatewayPolicy(orgId: string, values: Record<string, unknown>): Promise<ResolvedOrgLimits> {
  const row = await upsertGatewayOrgPolicyRow(orgId, values as never);
  const settings = await getGatewaySettings();

  return resolveOrgLimits(settings, row as GatewayOrgPolicy);
}
