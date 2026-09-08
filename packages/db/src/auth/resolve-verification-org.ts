import { getTenantSiteNameFromHost, isPlatformHost } from '@cio/utils/constants/domains';

import type { TOrganization } from '../types';
import {
  getFirstOrganization,
  getOrganizationByCustomDomain,
  getOrganizationByProfileId,
  getOrganizationBySiteName
} from '../queries/organization/organization';

function extractCallbackUrl(verificationUrl: string): URL | null {
  try {
    const parsed = new URL(verificationUrl);
    const callback = parsed.searchParams.get('callbackURL');
    if (!callback) {
      return null;
    }

    return new URL(callback);
  } catch {
    return null;
  }
}

/** A customer's own domain: anything that is not localhost and not ours. */
function isCustomDomainHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, '').toLowerCase();

  return !host.includes('localhost') && !isPlatformHost(host);
}

async function resolveOrgFromCallbackUrl(callbackUrl: URL): Promise<TOrganization | null> {
  const orgSiteName = callbackUrl.searchParams.get('org')?.trim();
  if (orgSiteName) {
    const org = await getOrganizationBySiteName(orgSiteName);
    if (org) {
      return org;
    }
  }

  const hostname = callbackUrl.hostname.toLowerCase();

  if (isCustomDomainHost(hostname)) {
    const org = await getOrganizationByCustomDomain(hostname);
    if (org) {
      return org;
    }
  }

  const siteName = getTenantSiteNameFromHost(hostname);
  if (siteName) {
    return getOrganizationBySiteName(siteName);
  }

  return null;
}

/**
 * Resolves the tenant org that should brand a verification email from the
 * Better Auth verification URL's `callbackURL` (where the user started the
 * flow), with fallbacks for self-hosted and existing memberships.
 */
export async function resolveVerificationOrg(options: {
  verificationUrl: string;
  userId?: string;
}): Promise<TOrganization | null> {
  const callbackUrl = extractCallbackUrl(options.verificationUrl);
  if (callbackUrl) {
    const org = await resolveOrgFromCallbackUrl(callbackUrl);
    if (org) {
      return org;
    }
  }

  if (process.env.PUBLIC_IS_SELFHOSTED === 'true') {
    const org = await getFirstOrganization();
    if (org) {
      return org;
    }
  }

  if (options.userId) {
    const memberships = await getOrganizationByProfileId(options.userId);
    const org = memberships[0];
    if (org) {
      return org;
    }
  }

  return null;
}
