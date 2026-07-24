import { inArray } from 'drizzle-orm';

import * as schema from '@db/schema';
import { createOrganization, createOrganizationMember } from '@db/queries/organization/organization';
import { db } from '@db/drizzle';

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
