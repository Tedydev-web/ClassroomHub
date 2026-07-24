import { AppError, ErrorCodes } from '@api/utils/errors';

import { checkSiteNameExists } from '@cio/db/queries/organization';
import { createOrgWithAdmin } from '@cio/db/queries/admin';
import { getProfileById } from '@cio/db/queries/auth';
import { upsertCreditBalance } from '@cio/db/queries/agent';

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
