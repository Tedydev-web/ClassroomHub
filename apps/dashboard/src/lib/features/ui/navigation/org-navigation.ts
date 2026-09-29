import {
  ChartColumnIcon,
  AttachmentIcon,
  CommunityIcon,
  CourseIcon,
  DashboardIcon,
  GoalIcon,
  HomeIcon,
  LandingPageIcon,
  PeopleIcon,
  SettingsIcon,
  SetupIcon,
  TagIcon,
  WidgetsIcon
} from '@cio/ui/custom/moving-icons';

import type { AccountOrg } from '$features/app/types';
import BotIcon from '@lucide/svelte/icons/bot';
import PackageOpenIcon from '@lucide/svelte/icons/package-open';
import type { Component } from 'svelte';
import { isActive } from '$lib/utils/functions/app';
import { IS_AI_ENABLED } from '$lib/utils/constants/ai';
import type { PlanLimitResource } from '@cio/utils/plans';
import { isSelfOwnedDeployment } from '$lib/utils/deployment';
import { isOrgFeatureEnabled, type OrgFeatureFlags, type OrgFeatureKey } from '@cio/utils/constants/org-features';
import type { OrgNavCountKey, OrgNavCounts } from '$features/ui/sidebar/org-sidebar/org-nav-counts.svelte';

export interface NavItem {
  title: string;
  url: string;
  path: string; // Actual path (e.g., '/settings') for breadcrumb generation
  /** Stable Playwright hook, e.g. org-nav-courses */
  testId: string;
  icon?: Component;
  isActive?: boolean;
  isExpanded?: boolean;
  /** When set, `isActive` for this item is determined by this regex on the pathname */
  matchPattern?: string;
  items?: NavItem[]; // for nested items like settings
  isPaid?: boolean; // Show upgrade indicator for free plan users
  /** True when this item's plan-limited resource has hit its cap (drives the upgrade indicator). */
  upgrade?: boolean;
  /** Total shown as a pill in the sidebar, resolved from org nav counts via `countKey`. */
  count?: number;
  disabled?: boolean;
  // Metadata for breadcrumb generation
  useHashUrl?: boolean; // Use '#' as URL (for collapsible items like settings)
  nestedRoutes?: NestedRouteConfig[]; // Static nested routes (like community/ask, settings/customize-lms)
  supportsDynamicSegment?: boolean; // Supports dynamic segments (like [slug])
}

export interface NavItemConfig {
  titleKey: string;
  path: string;
  icon?: Component;
  requiresAdmin?: boolean;
  disableWhenNotAdmin?: boolean;
  items?: NavItemConfig[];
  useHashUrl?: boolean; // Use '#' as URL (for collapsible items like settings)
  nestedRoutes?: NestedRouteConfig[]; // Static nested routes
  supportsDynamicSegment?: boolean; // Supports dynamic segments (like [slug])
  matchPattern?: string | ((orgSlug: string) => string); // Regex pattern for route matching
  isPaid?: boolean; // Show upgrade indicator for free plan users
  /** Plan-limited resource this item represents; when that resource is at its cap, `upgrade` is set. */
  upgradeResource?: PlanLimitResource;
  /** Override the default org-nav-* test id derived from `path`. */
  testId?: string;
  group?: string | null; // Group label key for sidebar grouping
  /** Keep in search/breadcrumbs but do not render in the org sidebar. */
  hideFromSidebar?: boolean;
  /**
   * Per-org switch that governs this item. Absent means the item is always
   * present — `home` and `settings` deliberately have no key, since an org with
   * neither would have no landing page and no way to reach its own settings.
   */
  featureKey?: OrgFeatureKey;
  /** When set, the org sidebar shows the matching total from org nav counts. */
  countKey?: OrgNavCountKey;
}

export interface NavGroup {
  labelKey: string | null;
  items: NavItem[];
}

export interface NestedRouteConfig {
  path: string; // Relative to parent (e.g., 'ask', 'customize-lms')
  titleKey: string; // Translation key or plain text
}

/** Stable sidebar nav hook from a route path segment (locale-independent). */
export function orgNavTestId(path: string): string {
  if (!path) {
    return 'org-nav-home';
  }

  const slug = path.replace(/^\//, '').replace(/\//g, '-');
  return `org-nav-${slug}`;
}

function resolveNavTestId(path: string, testId?: string): string {
  return testId ?? orgNavTestId(path);
}

// Base navigation configuration structure
export const baseNavConfig: NavItemConfig[] = [
  {
    group: null,
    titleKey: 'org_navigation.home',
    path: '',
    icon: HomeIcon,
    matchPattern: '^/org/[^/]+/?$'
  },
  {
    group: null,
    titleKey: 'org_navigation.dashboard',
    featureKey: 'dashboard',
    path: '/dash',
    icon: DashboardIcon,
    matchPattern: '^/org/[^/]+/dash(/.*)?$'
  },
  {
    group: null,
    titleKey: 'org_navigation.stats',
    featureKey: 'stats',
    path: '/stats',
    icon: ChartColumnIcon,
    useHashUrl: true,
    matchPattern: '^/org/[^/]+/(analytics|compliance)(/.*)?$',
    items: [
      {
        titleKey: 'org_navigation.analytics',
        path: '/analytics',
        matchPattern: '^/org/[^/]+/analytics(/.*)?$'
      },
      {
        titleKey: 'org_navigation.compliance',
        path: '/compliance',
        requiresAdmin: true,
        matchPattern: '^/org/[^/]+/compliance(/.*)?$'
      }
    ]
  },
  {
    group: null,
    titleKey: 'org_navigation.setup',
    featureKey: 'setup',
    path: '/setup',
    icon: SetupIcon,
    requiresAdmin: true,
    matchPattern: '^/org/[^/]+/setup(/.*)?$'
  },
  {
    group: 'content',
    titleKey: 'org_navigation.courses',
    featureKey: 'courses',
    countKey: 'courses',
    path: '/courses',
    icon: CourseIcon,
    matchPattern: '^/org/[^/]+/courses(/.*)?$',
    nestedRoutes: [{ titleKey: 'course_templates.gallery.title', path: 'templates' }]
  },
  {
    group: 'content',
    titleKey: 'org_navigation.cohorts',
    featureKey: 'cohorts',
    countKey: 'cohorts',
    path: '/cohorts',
    icon: GoalIcon,
    matchPattern: '^/org/[^/]+/cohorts(/.*)?$'
  },
  {
    group: 'content',
    titleKey: 'org_navigation.media',
    featureKey: 'media',
    countKey: 'media',
    path: '/media',
    icon: AttachmentIcon,
    matchPattern: '^/org/[^/]+/media(/.*)?$'
  },
  {
    group: 'content',
    titleKey: 'scorm.title',
    featureKey: 'scorm',
    path: '/scorm',
    icon: PackageOpenIcon,
    requiresAdmin: true,
    matchPattern: '^/org/[^/]+/scorm(/.*)?$'
  },
  {
    group: 'content',
    titleKey: 'org_navigation.tags',
    featureKey: 'tags',
    countKey: 'tags',
    path: '/tags',
    icon: TagIcon,
    requiresAdmin: true,
    matchPattern: '^/org/[^/]+/tags(/.*)?$'
  },
  {
    group: 'distribute',
    titleKey: 'org_navigation.widgets',
    featureKey: 'widgets',
    path: '/widgets',
    icon: WidgetsIcon,
    matchPattern: '^(/org/[^/]+/widgets(/.*)?|/widgets/[^/]+(/.*)?)$'
  },
  {
    group: 'distribute',
    titleKey: 'settings.tabs.landing_page_tab',
    path: '/landingpage',
    icon: LandingPageIcon,
    requiresAdmin: true,
    matchPattern: '^/org/[^/]+/landingpage(/.*)?$'
  },
  {
    group: 'people',
    titleKey: 'org_navigation.audience',
    featureKey: 'audience',
    path: '/audience',
    icon: PeopleIcon,
    upgradeResource: 'students',
    matchPattern: '^/org/[^/]+/audience(/.*)?$' // Matches nested routes
  },
  {
    group: 'people',
    titleKey: 'org_navigation.community',
    featureKey: 'community',
    path: '/community',
    icon: CommunityIcon,
    supportsDynamicSegment: true, // Supports /community/[slug]
    matchPattern: '^/org/[^/]+/community(/.*)?$', // Matches nested routes
    nestedRoutes: [
      {
        path: 'ask',
        titleKey: 'Ask Question' // Could be translated
      }
    ]
  },
  {
    group: 'automation',
    titleKey: 'org_navigation.automation',
    path: '/automation/mcp',
    icon: BotIcon,
    requiresAdmin: true,
    disableWhenNotAdmin: true,
    matchPattern: '^/org/[^/]+/(automation|mcp|api|zapier|webhooks)(/.*)?$',
    nestedRoutes: [
      { path: 'mcp', titleKey: 'automation.tabs.mcp' },
      { path: 'api', titleKey: 'automation.tabs.api' },
      { path: 'zapier', titleKey: 'automation.tabs.zapier' }
    ]
  },
  {
    titleKey: 'org_navigation.settings',
    path: '/settings',
    icon: SettingsIcon,
    hideFromSidebar: true,
    matchPattern: '^/org/[^/]+/settings(/.*)?$', // Matches nested routes
    nestedRoutes: [
      {
        path: 'notifications',
        titleKey: 'settings.tabs.notifications_tab'
      },
      {
        path: 'billing',
        titleKey: 'settings.tabs.billing_tab'
      },
      {
        path: 'ai-credits',
        titleKey: 'settings.tabs.ai_credits_tab'
      },
      {
        path: 'ai-tutor',
        titleKey: 'settings.tabs.ai_tutor_tab'
      },
      {
        path: 'domains',
        titleKey: 'settings.tabs.domains_tab'
      },
      {
        path: 'teams',
        titleKey: 'settings.tabs.teams_tab'
      },
      {
        path: 'auth',
        titleKey: 'settings.tabs.auth_tab'
      },
      {
        path: 'auth/sso',
        titleKey: 'settings.tabs.sso_tab'
      },
      {
        path: 'auth/token-auth',
        titleKey: 'settings.tabs.token_auth_tab'
      }
    ]
  }
];

function isAiSettingsPath(path: string | undefined): boolean {
  if (!path) return false;

  return path.includes('ai-tutor') || path.includes('ai-credits');
}

function isHomePath(path: string): boolean {
  return path === '';
}

/**
 * Nav config with the Home item and AI-related settings tabs removed when AI is turned off.
 */
const resolvedNavConfig = IS_AI_ENABLED
  ? baseNavConfig
  : baseNavConfig
      .filter((config) => !isHomePath(config.path))
      .map((config) => ({
        ...config,
        items: config.items?.filter((sub) => !isAiSettingsPath(sub.path)),
        nestedRoutes: config.nestedRoutes?.filter((route) => !isAiSettingsPath(route.path))
      }));

/**
 * Get navigation items based on organization context and permissions
 */
export function getOrgNavigationItems(
  currentOrgPath: string,
  currentOrg: AccountOrg,
  isOrgAdmin: boolean | null,
  t: (key: string) => string,
  pagePathname: string
): NavItem[] {
  const items: NavItem[] = [];

  for (const config of resolvedNavConfig) {
    // Skip admin-only items if user is not admin
    if (config.requiresAdmin && !isOrgAdmin && !config.disableWhenNotAdmin) {
      continue;
    }

    const visibleSubConfigs = config.items?.filter((sub) => !sub.requiresAdmin || isOrgAdmin) ?? [];

    if (config.items && visibleSubConfigs.length === 0) {
      continue;
    }

    const url = config.path === '' ? currentOrgPath : `${currentOrgPath}${config.path}`;
    const fullPath = config.path === '' ? `/org/${currentOrg.siteName}` : `/org/${currentOrg.siteName}${config.path}`;

    // Extract match pattern (handle function case)
    const matchPattern =
      typeof config.matchPattern === 'function' ? config.matchPattern(currentOrg.siteName!) : config.matchPattern;

    const item: NavItem = {
      title: t(config.titleKey),
      url: config.useHashUrl ? '#' : url,
      path: config.path, // Store actual path for breadcrumb generation
      testId: resolveNavTestId(config.path, config.testId),
      icon: config.icon,
      matchPattern,
      isActive: isActive(pagePathname, fullPath, matchPattern),
      isExpanded: config.items ? isActive(pagePathname, fullPath, matchPattern) : undefined,
      disabled: Boolean(config.disableWhenNotAdmin && !isOrgAdmin),
      useHashUrl: config.useHashUrl,
      nestedRoutes: config.nestedRoutes,
      supportsDynamicSegment: config.supportsDynamicSegment,
      isPaid: config.isPaid
    };

    // Handle nested items (like settings sub-items)
    if (visibleSubConfigs.length > 0) {
      item.items = visibleSubConfigs.map((subConfig) => {
        const subMatchPattern =
          typeof subConfig.matchPattern === 'function'
            ? subConfig.matchPattern(currentOrg.siteName!)
            : subConfig.matchPattern;
        const subUrl = `${currentOrgPath}${subConfig.path}`;

        return {
          title: t(subConfig.titleKey),
          isActive: isActive(pagePathname, subUrl, subMatchPattern, true),
          url: subUrl,
          path: subConfig.path,
          testId: resolveNavTestId(subConfig.path, subConfig.testId),
          matchPattern: subMatchPattern,
          isPaid: subConfig.isPaid,
          nestedRoutes: subConfig.nestedRoutes
        };
      });
    }

    items.push(item);
  }

  return items;
}

const GROUP_ORDER: Array<{ key: string | null; labelKey: string | null }> = [
  { key: null, labelKey: null },
  { key: 'content', labelKey: 'org_navigation.create' },
  { key: 'distribute', labelKey: 'org_navigation.distribute' },
  { key: 'people', labelKey: 'org_navigation.people' },
  { key: 'automation', labelKey: 'org_navigation.tools' }
];

/** Reads an org's feature switches out of its settings blob. */
export function getOrgFeatureFlags(currentOrg: AccountOrg | null | undefined): OrgFeatureFlags {
  return (currentOrg?.settings?.features ?? {}) as OrgFeatureFlags;
}

/**
 * Names the switched-off feature that owns `pathname`, or null when the path is
 * reachable. Drives the redirect in the org layout so a direct URL cannot land
 * on a page whose sidebar entry the operator removed.
 *
 * Matching reuses each item's `matchPattern` — the same expression that decides
 * whether the item renders as active — so navigation and access can never
 * disagree about which routes an item covers.
 */
export function findDisabledOrgFeature(
  currentOrg: AccountOrg | null | undefined,
  pathname: string
): OrgFeatureKey | null {
  // Only dashboard org routes are governed. Some patterns (widgets) also match
  // a public path outside `/org/`, which carries no org context to gate on.
  if (!pathname.startsWith('/org/')) return null;

  const features = getOrgFeatureFlags(currentOrg);
  const siteName = currentOrg?.siteName ?? '';

  // Check granular automation sub-features
  if (!isOrgFeatureEnabled(features, 'mcp') && new RegExp(`^/org/[^/]+/(automation/mcp|mcp)(/.*)?$`).test(pathname)) {
    return 'mcp';
  }
  if (!isOrgFeatureEnabled(features, 'api') && new RegExp(`^/org/[^/]+/(automation/api|api)(/.*)?$`).test(pathname)) {
    return 'api';
  }
  if (
    !isOrgFeatureEnabled(features, 'zapier') &&
    new RegExp(`^/org/[^/]+/(automation/zapier|zapier)(/.*)?$`).test(pathname)
  ) {
    return 'zapier';
  }
  if (!isOrgFeatureEnabled(features, 'webhooks') && new RegExp(`^/org/[^/]+/webhooks(/.*)?$`).test(pathname)) {
    return 'webhooks';
  }

  for (const config of resolvedNavConfig) {
    if (!config.featureKey) continue;
    if (isOrgFeatureEnabled(features, config.featureKey)) continue;

    const pattern = typeof config.matchPattern === 'function' ? config.matchPattern(siteName) : config.matchPattern;
    if (!pattern) continue;

    if (new RegExp(pattern).test(pathname)) return config.featureKey;
  }

  return null;
}

/**
 * Get navigation items grouped for the sidebar
 */
export function getOrgNavigationGroups(
  currentOrgPath: string,
  currentOrg: AccountOrg,
  isOrgAdmin: boolean | null,
  t: (key: string) => string,
  pagePathname: string,
  limitsReached: Partial<Record<PlanLimitResource, boolean>> = {},
  counts: OrgNavCounts | null = null
): NavGroup[] {
  const pathnameOnly = pagePathname.split('?')[0];
  const groupedMap = new Map<string | null, NavItem[]>();

  for (const groupDef of GROUP_ORDER) {
    groupedMap.set(groupDef.key, []);
  }

  const features = getOrgFeatureFlags(currentOrg);

  for (const config of resolvedNavConfig) {
    if (config.hideFromSidebar) {
      continue;
    }

    if (isSelfOwnedDeployment && config.path === '/settings/billing') {
      continue;
    }

    if (config.featureKey && !isOrgFeatureEnabled(features, config.featureKey)) {
      continue;
    }

    if (config.group === 'automation') {
      const isMcpOn = isOrgFeatureEnabled(features, 'mcp');
      const isApiOn = isOrgFeatureEnabled(features, 'api');
      const isZapierOn = isOrgFeatureEnabled(features, 'zapier');
      const isWebhooksOn = isOrgFeatureEnabled(features, 'webhooks');
      if (!isMcpOn && !isApiOn && !isZapierOn && !isWebhooksOn) {
        continue;
      }
    }

    if (config.requiresAdmin && !isOrgAdmin && !config.disableWhenNotAdmin) {
      continue;
    }

    const visibleSubConfigs =
      config.items?.filter(
        (sub) => (!sub.requiresAdmin || isOrgAdmin) && (!isSelfOwnedDeployment || sub.path !== '/settings/billing')
      ) ?? [];

    if (config.items && visibleSubConfigs.length === 0) {
      continue;
    }

    let itemPath = config.path;
    if (config.group === 'automation' && config.path === '/automation/mcp') {
      if (!isOrgFeatureEnabled(features, 'mcp')) {
        if (isOrgFeatureEnabled(features, 'api')) {
          itemPath = '/automation/api';
        } else if (isOrgFeatureEnabled(features, 'zapier')) {
          itemPath = '/automation/zapier';
        }
      }
    }

    const url = itemPath === '' ? currentOrgPath : `${currentOrgPath}${itemPath}`;
    const fullPath = itemPath === '' ? `/org/${currentOrg.siteName}` : `/org/${currentOrg.siteName}${itemPath}`;
    const matchPattern =
      typeof config.matchPattern === 'function' ? config.matchPattern(currentOrg.siteName!) : config.matchPattern;

    const item: NavItem = {
      title: t(config.titleKey),
      url: config.useHashUrl ? '#' : url,
      path: itemPath,
      testId: resolveNavTestId(config.path, config.testId),
      icon: config.icon,
      matchPattern,
      isActive: isActive(pathnameOnly, fullPath, matchPattern),
      isExpanded: config.items ? isActive(pathnameOnly, fullPath, matchPattern) : undefined,
      disabled: Boolean(config.disableWhenNotAdmin && !isOrgAdmin),
      useHashUrl: config.useHashUrl,
      nestedRoutes: config.nestedRoutes,
      supportsDynamicSegment: config.supportsDynamicSegment,
      isPaid: config.isPaid,
      upgrade: config.upgradeResource ? Boolean(limitsReached[config.upgradeResource]) : undefined,
      count: config.countKey && counts ? counts[config.countKey] : undefined
    };

    if (visibleSubConfigs.length > 0) {
      item.items = visibleSubConfigs.map((subConfig) => {
        const subMatchPattern =
          typeof subConfig.matchPattern === 'function'
            ? subConfig.matchPattern(currentOrg.siteName!)
            : subConfig.matchPattern;
        const subUrl = `${currentOrgPath}${subConfig.path}`;
        return {
          title: t(subConfig.titleKey),
          isActive: isActive(pathnameOnly, subUrl, subMatchPattern, true),
          url: subUrl,
          path: subConfig.path,
          testId: resolveNavTestId(subConfig.path, subConfig.testId),
          matchPattern: subMatchPattern,
          isPaid: subConfig.isPaid,
          nestedRoutes: subConfig.nestedRoutes
        };
      });
    }

    const groupKey = config.group !== undefined ? config.group : null;
    const bucket = groupedMap.get(groupKey) ?? groupedMap.get(null)!;
    bucket.push(item);
  }

  return GROUP_ORDER.filter(({ key }) => (groupedMap.get(key) ?? []).length > 0).map(({ key, labelKey }) => ({
    labelKey,
    items: groupedMap.get(key) ?? []
  }));
}
