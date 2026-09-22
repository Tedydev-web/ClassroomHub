import { describe, expect, it } from 'vitest';
import type { AccountOrg } from '$features/app/types';
import { findDisabledOrgFeature, getOrgNavigationGroups } from './org-navigation';
import { mergeOrgFeatures, resolveOrgFeatures, type OrgFeatureFlags } from '@cio/utils/constants/org-features';

/** Minimal org shaped like the account payload, with only what navigation reads. */
function org(features?: OrgFeatureFlags): AccountOrg {
  return {
    id: 'org-1',
    name: 'Test Org',
    siteName: 'testorg',
    settings: features ? { features } : {}
  } as unknown as AccountOrg;
}

const t = (key: string) => key;

function itemTitles(groups: ReturnType<typeof getOrgNavigationGroups>): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.title));
}

function navFor(features?: OrgFeatureFlags) {
  return getOrgNavigationGroups('/org/testorg', org(features), true, t, '/org/testorg');
}

describe('sidebar feature switches', () => {
  it('shows every item when the org has no overrides', () => {
    const titles = itemTitles(navFor());

    expect(titles).toContain('org_navigation.courses');
    expect(titles).toContain('org_navigation.media');
    expect(titles).toContain('org_navigation.automation');
  });

  it('treats an explicit true the same as an absent key', () => {
    const titles = itemTitles(navFor({ courses: true }));
    expect(titles).toContain('org_navigation.courses');
  });

  it('removes only the switched-off item', () => {
    const titles = itemTitles(navFor({ courses: false }));

    expect(titles).not.toContain('org_navigation.courses');
    expect(titles).toContain('org_navigation.cohorts');
    expect(titles).toContain('org_navigation.media');
  });

  it('removes several at once', () => {
    const titles = itemTitles(navFor({ media: false, scorm: false }));

    expect(titles).not.toContain('org_navigation.media');
    expect(titles).not.toContain('scorm.title');
    expect(titles).toContain('org_navigation.tags');
  });

  it('removes automation when all automation features are off', () => {
    const titles = itemTitles(navFor({ mcp: false, api: false, zapier: false, webhooks: false }));
    expect(titles).not.toContain('org_navigation.automation');
  });

  it('always keeps home and landing page, which have no switch', () => {
    const everythingOff: OrgFeatureFlags = {
      dashboard: false,
      stats: false,
      setup: false,
      courses: false,
      cohorts: false,
      media: false,
      scorm: false,
      tags: false,
      widgets: false,
      community: false,
      audience: false,
      mcp: false,
      api: false,
      zapier: false,
      webhooks: false
    };

    const titles = itemTitles(navFor(everythingOff));

    expect(titles).toContain('org_navigation.home');
    expect(titles).toContain('settings.tabs.landing_page_tab');
    expect(titles).not.toContain('org_navigation.settings');
    expect(titles).toHaveLength(2);
  });

  it('drops a group label once its last item is switched off', () => {
    const groups = navFor({ mcp: false, api: false, zapier: false, webhooks: false });
    expect(groups.map((group) => group.labelKey)).not.toContain('org_navigation.tools');
  });
});

describe('findDisabledOrgFeature', () => {
  it('returns null when the feature is on', () => {
    expect(findDisabledOrgFeature(org(), '/org/testorg/courses')).toBeNull();
    expect(findDisabledOrgFeature(org({ media: false }), '/org/testorg/courses')).toBeNull();
  });

  it('names the feature that owns a switched-off route', () => {
    expect(findDisabledOrgFeature(org({ courses: false }), '/org/testorg/courses')).toBe('courses');
  });

  it('covers nested routes under a switched-off feature', () => {
    expect(findDisabledOrgFeature(org({ courses: false }), '/org/testorg/courses/abc/lessons')).toBe('courses');
  });

  it('maps both stats children to the stats switch', () => {
    expect(findDisabledOrgFeature(org({ stats: false }), '/org/testorg/analytics')).toBe('stats');
    expect(findDisabledOrgFeature(org({ stats: false }), '/org/testorg/compliance')).toBe('stats');
  });

  it('leaves the org home reachable no matter what is off', () => {
    expect(findDisabledOrgFeature(org({ dashboard: false, courses: false }), '/org/testorg')).toBeNull();
  });

  it('never gates settings', () => {
    expect(findDisabledOrgFeature(org({ courses: false }), '/org/testorg/settings/notifications')).toBeNull();
  });

  it('ignores paths outside the org section', () => {
    // The widgets pattern also matches a public `/widgets/:id` route, which
    // carries no org context to gate on.
    expect(findDisabledOrgFeature(org({ widgets: false }), '/widgets/abc')).toBeNull();
    expect(findDisabledOrgFeature(org({ courses: false }), '/lms/courses')).toBeNull();
  });

  it('gates the org-scoped widgets route', () => {
    expect(findDisabledOrgFeature(org({ widgets: false }), '/org/testorg/widgets')).toBe('widgets');
  });

  it('does not confuse a prefix with the real route', () => {
    // `/org/testorg/apikeys` must not be caught by the `api` switch.
    expect(findDisabledOrgFeature(org({ api: false }), '/org/testorg/apikeys')).toBeNull();
    expect(findDisabledOrgFeature(org({ api: false }), '/org/testorg/api')).toBe('api');
    expect(findDisabledOrgFeature(org({ api: false }), '/org/testorg/automation/api')).toBe('api');
  });
});

describe('feature flag resolution', () => {
  it('defaults every key to enabled', () => {
    const resolved = resolveOrgFeatures(undefined);
    expect(Object.values(resolved).every(Boolean)).toBe(true);
  });

  it('stores only the deviations', () => {
    expect(mergeOrgFeatures({}, { courses: false })).toEqual({ courses: false });
    // Turning one back on removes it rather than writing `true`.
    expect(mergeOrgFeatures({ courses: false, media: false }, { courses: true })).toEqual({ media: false });
  });

  it('ignores keys outside the catalog', () => {
    expect(mergeOrgFeatures({}, { nonsense: false } as OrgFeatureFlags)).toEqual({});
  });
});
