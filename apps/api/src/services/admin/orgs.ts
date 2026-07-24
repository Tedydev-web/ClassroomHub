import { AppError, ErrorCodes } from '@api/utils/errors';

import { checkSiteNameExists } from '@cio/db/queries/organization';
import { createOrgWithAdmin } from '@cio/db/queries/admin';
import { getProfileById } from '@cio/db/queries/auth';
import { updateOrgAiTutorSettings, upsertCreditBalance } from '@cio/db/queries/agent';

export async function addOrgCredits(orgId: string, amount: number): Promise<{ balance: number }> {
  const balance = await upsertCreditBalance(orgId, amount);
  return { balance };
}

/**
 * Creates an org owned by an existing user. Fails clearly if the owner does not
 * exist or the site name is taken, so the operator sees which precondition
 * broke rather than a raw constraint error from the transaction.
 */
export async function createOrgForUser(input: { name: string; siteName: string; ownerUserId: string }) {
  const owner = await getProfileById(input.ownerUserId);
  if (!owner) {
    throw new AppError(`Owner '${input.ownerUserId}' not found`, ErrorCodes.NOT_FOUND, 404);
  }

  if (await checkSiteNameExists(input.siteName)) {
    throw new AppError(`Site name '${input.siteName}' already exists`, ErrorCodes.SITENAME_EXISTS, 409);
  }

  return createOrgWithAdmin({
    name: input.name,
    siteName: input.siteName,
    profileId: input.ownerUserId
  });
}

/**
 * Toggles an org's AI tutor. Reuses the same merge-preserving update the org's
 * own settings screen uses (`updateOrgAiTutorSettings`), so this only ever
 * touches the `enabled` key and never clobbers persona/escalation/etc.
 */
export async function setOrgAiTutorEnabled(
  orgId: string,
  enabled: boolean
): Promise<{ orgId: string; enabled: boolean }> {
  const updated = await updateOrgAiTutorSettings(orgId, { enabled });

  if (!updated) {
    throw new AppError(`Organization '${orgId}' not found`, ErrorCodes.NOT_FOUND, 404);
  }

  return { orgId, enabled: updated.enabled };
}
