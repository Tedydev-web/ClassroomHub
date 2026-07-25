/**
 * Per-organisation sidebar feature switches.
 *
 * A tenant rarely needs every capability the product ships. These keys let an
 * operator hide the ones a given org does not use, so its sidebar reflects how
 * that org actually works rather than the full catalogue.
 *
 * Shared by three surfaces that must agree on the vocabulary: the admin panel
 * that writes the flags, the API that validates them, and the dashboard that
 * builds its navigation from them. It deliberately depends on nothing — no
 * database, no Svelte — so all three can import it.
 */

/**
 * Every switchable capability, in sidebar order.
 *
 * `home` and `settings` are absent by design: hiding either would leave an org
 * with no landing page and no way back to its own configuration.
 */
export const ORG_FEATURE_KEYS = [
  'dashboard',
  'stats',
  'setup',
  'courses',
  'cohorts',
  'media',
  'scorm',
  'tags',
  'widgets',
  'community',
  'audience',
  'mcp',
  'api',
  'zapier',
  'webhooks'
] as const;

export type OrgFeatureKey = (typeof ORG_FEATURE_KEYS)[number];

/** Flags as stored under `organization.settings.features`. */
export type OrgFeatureFlags = Partial<Record<OrgFeatureKey, boolean>>;

/**
 * Operator-facing names. The dashboard renders its own translated labels from
 * the navigation config; these exist for the admin panel, which is English-only
 * and single-operator.
 */
export const ORG_FEATURE_LABELS: Record<OrgFeatureKey, string> = {
  dashboard: 'Dashboard',
  stats: 'Stats (Analytics & Compliance)',
  setup: 'Setup',
  courses: 'Courses',
  cohorts: 'Cohorts',
  media: 'Media',
  scorm: 'SCORM',
  tags: 'Tags',
  widgets: 'Widgets',
  community: 'Community',
  audience: 'Audience',
  mcp: 'MCP',
  api: 'API',
  zapier: 'Zapier',
  webhooks: 'Webhooks'
};

/** Groups the keys the way the sidebar groups them, for a readable admin table. */
export const ORG_FEATURE_GROUPS: Array<{ label: string; keys: OrgFeatureKey[] }> = [
  { label: 'Home', keys: ['dashboard', 'stats', 'setup'] },
  { label: 'Content', keys: ['courses', 'cohorts', 'media', 'scorm', 'tags', 'widgets'] },
  { label: 'People', keys: ['community', 'audience'] },
  { label: 'Automation', keys: ['mcp', 'api', 'zapier', 'webhooks'] }
];

export function isOrgFeatureKey(value: unknown): value is OrgFeatureKey {
  return typeof value === 'string' && (ORG_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Resolves one flag. Absent means enabled: existing orgs were created before
 * these switches existed and must keep every capability they have today, and a
 * newly created org should start with the full product rather than an empty
 * sidebar an operator has to fill in.
 */
export function isOrgFeatureEnabled(features: OrgFeatureFlags | null | undefined, key: OrgFeatureKey): boolean {
  return features?.[key] !== false;
}

/**
 * Fills in the defaults so every key has an explicit value. Used by the admin
 * panel, whose toggles need a concrete state to render.
 */
export function resolveOrgFeatures(features: OrgFeatureFlags | null | undefined): Record<OrgFeatureKey, boolean> {
  const resolved = {} as Record<OrgFeatureKey, boolean>;

  for (const key of ORG_FEATURE_KEYS) {
    resolved[key] = isOrgFeatureEnabled(features, key);
  }

  return resolved;
}

/**
 * Merges a patch onto stored flags, keeping the record minimal: a key set back
 * to its default is removed rather than written as `true`. Keeps the stored
 * JSON to just the deviations, so reading a row shows what an operator actually
 * changed.
 */
export function mergeOrgFeatures(current: OrgFeatureFlags | null | undefined, patch: OrgFeatureFlags): OrgFeatureFlags {
  const merged: OrgFeatureFlags = { ...(current ?? {}) };

  for (const [key, value] of Object.entries(patch)) {
    if (!isOrgFeatureKey(key)) continue;

    if (value === false) {
      merged[key] = false;
    } else {
      delete merged[key];
    }
  }

  return merged;
}
