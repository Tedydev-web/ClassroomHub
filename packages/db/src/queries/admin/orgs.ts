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
