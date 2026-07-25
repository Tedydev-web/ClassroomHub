import { asc, eq, inArray } from 'drizzle-orm';

import * as schema from '@db/schema';
import { createOrganization, createOrganizationMember } from '@db/queries/organization/organization';
import { db } from '@db/drizzle';
import { mergeOrgFeatures, type OrgFeatureFlags } from '@cio/utils/constants/org-features';

const ADMIN_ROLE_ID = 1;

/**
 * Creates an organization and makes an existing profile its admin, in one
 * transaction so a failure never leaves an org with no owner. Mirrors the
 * onboarding path (`createOrganizationWithOwner`) but takes the target profile
 * from the super admin instead of the session, and skips the self-hosted
 * one-org guard — the panel is the operator surface where creating more orgs is
 * the whole point.
 */
export async function createOrgWithAdmin({
  name,
  siteName,
  profileId
}: {
  name: string;
  siteName: string;
  profileId: string;
}): Promise<{ org: typeof schema.organization.$inferSelect; member: typeof schema.organizationmember.$inferSelect }> {
  return db.transaction(async (tx) => {
    const org = await createOrganization({ name, siteName }, tx);
    const member = await createOrganizationMember(
      {
        organizationId: org.id,
        profileId,
        roleId: ADMIN_ROLE_ID,
        verified: true
      },
      tx
    );

    return { org, member };
  });
}

/**
 * Bulk-reads whether each org's AI tutor is enabled, for the gateway orgs
 * panel. Missing ids (deleted org) are simply absent from the result — the
 * schema default (`enabled: true`) is not assumed here since we only return
 * rows that actually exist.
 */
export async function getOrgAiTutorEnabledMap(orgIds: string[]): Promise<Record<string, boolean>> {
  if (orgIds.length === 0) return {};

  try {
    const rows = await db
      .select({ id: schema.organization.id, aiTutorSettings: schema.organization.aiTutorSettings })
      .from(schema.organization)
      .where(inArray(schema.organization.id, orgIds));

    return Object.fromEntries(rows.map((row) => [row.id, row.aiTutorSettings.enabled]));
  } catch (error) {
    console.error('getOrgAiTutorEnabledMap error:', error);
    throw new Error('Failed to fetch org AI tutor enabled flags');
  }
}

export interface AdminOrgFeatureRow {
  orgId: string;
  name: string;
  siteName: string | null;
  features: OrgFeatureFlags;
}

/**
 * Lists every org with the sidebar features it has switched off, for the
 * operator panel. Only the three columns the panel renders are selected — the
 * organization row carries large JSON blobs (landing page, AI tutor settings)
 * that this screen never reads.
 */
export async function listOrgFeatureRows(): Promise<AdminOrgFeatureRow[]> {
  try {
    const rows = await db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        siteName: schema.organization.siteName,
        settings: schema.organization.settings
      })
      .from(schema.organization)
      .orderBy(asc(schema.organization.name));

    return rows.map((row) => ({
      orgId: row.id,
      name: row.name,
      siteName: row.siteName,
      features: (row.settings?.features ?? {}) as OrgFeatureFlags
    }));
  } catch (error) {
    console.error('listOrgFeatureRows error:', error);
    throw new Error('Failed to list organization features');
  }
}

/**
 * Applies a partial feature patch to an org.
 *
 * Reads and writes the whole `settings` object because the column is a single
 * JSONB value: writing only `features` would drop the signup, notification and
 * enrollment settings that live beside it.
 */
export async function updateOrgFeatures(orgId: string, patch: OrgFeatureFlags): Promise<OrgFeatureFlags | null> {
  try {
    const [existing] = await db
      .select({ settings: schema.organization.settings })
      .from(schema.organization)
      .where(eq(schema.organization.id, orgId))
      .limit(1);

    if (!existing) return null;

    const currentSettings = existing.settings ?? {};
    const nextFeatures = mergeOrgFeatures(currentSettings.features as OrgFeatureFlags | undefined, patch);

    const [updated] = await db
      .update(schema.organization)
      .set({ settings: { ...currentSettings, features: nextFeatures } })
      .where(eq(schema.organization.id, orgId))
      .returning({ settings: schema.organization.settings });

    return (updated?.settings?.features ?? {}) as OrgFeatureFlags;
  } catch (error) {
    console.error('updateOrgFeatures error:', error);
    throw new Error('Failed to update organization features');
  }
}
