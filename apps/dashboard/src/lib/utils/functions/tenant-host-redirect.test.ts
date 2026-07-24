import { describe, expect, it } from 'vitest';
import {
  classifyHost,
  isPlatformAdminEmail,
  memberSiteNames,
  pickHomeSiteName,
  resolveTenantHostRedirect,
  type TenantHostRedirectInput
} from './tenant-host-redirect';

const HUB = 'hub.classroom.io.vn';
const ROOT = 'classroom.io.vn';

/** A member of `msna`, on their own tenant host, guard enabled. Override per case. */
function input(overrides: Partial<TenantHostRedirectInput> = {}): TenantHostRedirectInput {
  return {
    enabled: true,
    hostname: 'msna.classroom.io.vn',
    pathAndSearch: '/lms',
    isAuthenticated: true,
    isPublicPath: false,
    userEmail: 'student@example.com',
    memberSiteNames: ['msna'],
    homeSiteName: 'msna',
    platformAdminEmails: ['operator@classroom.io.vn'],
    hubHost: HUB,
    tenantRoot: ROOT,
    ...overrides
  };
}

describe('classifyHost', () => {
  it('recognizes the hub host', () => {
    expect(classifyHost(HUB, HUB, ROOT)).toEqual({ kind: 'hub' });
  });

  it('recognizes a tenant subdomain and extracts the site name', () => {
    expect(classifyHost('msna.classroom.io.vn', HUB, ROOT)).toEqual({ kind: 'tenant', siteName: 'msna' });
  });

  it('treats custom domains, localhost, apex, and deep names as other', () => {
    expect(classifyHost('learn.acme.com', HUB, ROOT).kind).toBe('other');
    expect(classifyHost('localhost', HUB, ROOT).kind).toBe('other');
    expect(classifyHost('classroom.io.vn', HUB, ROOT).kind).toBe('other');
    expect(classifyHost('a.b.classroom.io.vn', HUB, ROOT).kind).toBe('other');
  });
});

describe('isPlatformAdminEmail', () => {
  it('matches case-insensitively and ignores surrounding space', () => {
    expect(isPlatformAdminEmail('Op@classroom.io.vn', [' op@classroom.io.vn '])).toBe(true);
  });

  it('is false for null or a non-member', () => {
    expect(isPlatformAdminEmail(null, ['op@x'])).toBe(false);
    expect(isPlatformAdminEmail('someone@x', ['op@x'])).toBe(false);
  });
});

describe('memberSiteNames', () => {
  it('collects site names and drops orgs without one', () => {
    expect(memberSiteNames([{ siteName: 'msna' }, { siteName: null }, { siteName: 'acme' }])).toEqual(['msna', 'acme']);
  });
});

describe('pickHomeSiteName', () => {
  it('prefers a top-level org over a sub-workspace', () => {
    expect(
      pickHomeSiteName([
        { siteName: 'sub', parentOrganizationId: 'parent-id' },
        { siteName: 'msna', parentOrganizationId: null }
      ])
    ).toBe('msna');
  });

  it('falls back to any org with a site name, and null when there is none', () => {
    expect(pickHomeSiteName([{ siteName: 'sub', parentOrganizationId: 'p' }])).toBe('sub');
    expect(pickHomeSiteName([{ siteName: null }])).toBeNull();
    expect(pickHomeSiteName([])).toBeNull();
  });
});

describe('resolveTenantHostRedirect', () => {
  it('is inert while the flag is off', () => {
    expect(resolveTenantHostRedirect(input({ enabled: false, hostname: HUB }))).toBeNull();
  });

  it('leaves a member on their own tenant host', () => {
    expect(resolveTenantHostRedirect(input())).toBeNull();
  });

  it('bounces a non-operator off the hub to their home org, preserving the path', () => {
    const result = resolveTenantHostRedirect(
      input({ hostname: HUB, pathAndSearch: '/home?x=1', memberSiteNames: ['msna'], homeSiteName: 'msna' })
    );

    expect(result).toEqual({ location: 'https://msna.classroom.io.vn/home?x=1' });
  });

  it('never bounces an operator — no hub lockout', () => {
    expect(resolveTenantHostRedirect(input({ hostname: HUB, userEmail: 'operator@classroom.io.vn' }))).toBeNull();
  });

  it('keeps a no-org user on the hub (onboarding lives there)', () => {
    expect(resolveTenantHostRedirect(input({ hostname: HUB, memberSiteNames: [], homeSiteName: null }))).toBeNull();
  });

  it('bounces a user off a tenant they do not belong to, to their own', () => {
    const result = resolveTenantHostRedirect(
      input({ hostname: 'other.classroom.io.vn', memberSiteNames: ['msna'], homeSiteName: 'msna' })
    );

    expect(result).toEqual({ location: 'https://msna.classroom.io.vn/lms' });
  });

  it('never bounces on a public path — invite acceptance survives', () => {
    // A not-yet-member opening an invite on a tenant host must stay put.
    expect(
      resolveTenantHostRedirect(
        input({ hostname: 'msna.classroom.io.vn', isPublicPath: true, memberSiteNames: [], homeSiteName: null })
      )
    ).toBeNull();
  });

  it('never bounces anonymous traffic (the login flow owns that)', () => {
    expect(resolveTenantHostRedirect(input({ hostname: HUB, isAuthenticated: false }))).toBeNull();
  });

  it('leaves custom-domain and localhost hosts untouched', () => {
    expect(resolveTenantHostRedirect(input({ hostname: 'learn.acme.com' }))).toBeNull();
    expect(resolveTenantHostRedirect(input({ hostname: 'localhost' }))).toBeNull();
  });

  it('cannot loop: a bounce always targets a host the user is a member of', () => {
    // Simulate the redirect target being re-evaluated: on the home host the user
    // is a member, so the second pass returns null.
    const first = resolveTenantHostRedirect(input({ hostname: HUB, memberSiteNames: ['msna'], homeSiteName: 'msna' }));
    expect(first).toEqual({ location: 'https://msna.classroom.io.vn/lms' });

    const second = resolveTenantHostRedirect(input({ hostname: 'msna.classroom.io.vn' }));
    expect(second).toBeNull();
  });
});
