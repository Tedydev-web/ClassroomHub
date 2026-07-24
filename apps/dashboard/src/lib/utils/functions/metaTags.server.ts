import { PRODUCT_NAME } from '@cio/utils/constants';
import type { MetaTagsProps } from 'svelte-meta-tags';
import type { OrgSiteInfo } from '$features/app/layout-setup';
import { PUBLIC_IS_SELFHOSTED } from '$env/static/public';
import { env as publicEnv } from '$env/dynamic/public';
import { buildOrgSiteTitle, extractOrgSiteMetaCopy } from '$lib/utils/functions/org-site-meta';
import { resolveOrgSiteOgImageUrl } from '$lib/utils/functions/org-site-og-url';

const isSelfHosted = PUBLIC_IS_SELFHOSTED === 'true';

const DEFAULT_TITLE = `${PRODUCT_NAME} | One Platform for Customer, Partner, and Employee Training`;
const DEFAULT_DESCRIPTION =
  'One platform for customer academies, partner certification, and employee training. Build courses with AI, publish under your domain, and track completions.';
const CLOUD_OG_IMAGE = '/classroomio-opengraph-image.png';
const ORG_OG_WIDTH = 1200;
const ORG_OG_HEIGHT = 630;

async function resolveOgImageUrl(url: URL, orgSiteInfo: OrgSiteInfo): Promise<string> {
  const envUrl = publicEnv.PUBLIC_OG_IMAGE_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  if (orgSiteInfo.isOrgSite && orgSiteInfo.org?.siteName) {
    const dynamicOgUrl = await resolveOrgSiteOgImageUrl({
      siteName: orgSiteInfo.org.siteName,
      pageOrigin: url.origin,
      isSelfHosted,
      mediaCdnUrl: publicEnv.PUBLIC_MEDIA_CDN_URL,
      publicServerUrl: publicEnv.PUBLIC_SERVER_URL
    });
    if (dynamicOgUrl) {
      return dynamicOgUrl;
    }
  }

  if (isSelfHosted) {
    const org = orgSiteInfo.org;
    if (!org) {
      return CLOUD_OG_IMAGE;
    }

    const orgImage =
      org.avatarUrl ||
      org.landingpage?.header?.banner?.image ||
      (org as { customization?: { dashboard?: { bannerImage?: string } } }).customization?.dashboard?.bannerImage;
    if (orgImage) {
      try {
        return new URL(orgImage, url.origin).href;
      } catch {
        // fall through to bundled default
      }
    }
  }

  return CLOUD_OG_IMAGE;
}

function buildOrgOpenGraphImages(ogImageUrl: string, orgName: string) {
  return [
    {
      url: ogImageUrl,
      alt: `${orgName} learning platform`,
      width: ORG_OG_WIDTH,
      height: ORG_OG_HEIGHT,
      secureUrl: ogImageUrl.startsWith('https://') ? ogImageUrl : undefined,
      type: 'image/png'
    }
  ];
}

function resolveOrgSiteMeta(orgSiteInfo: OrgSiteInfo): {
  title: string;
  description: string;
  siteName: string;
} | null {
  const org = orgSiteInfo.org;
  if (!orgSiteInfo.isOrgSite || !org?.name?.trim()) {
    return null;
  }

  const orgName = org.name.trim();
  const metaCopy = extractOrgSiteMetaCopy(org.landingpage);

  return {
    title: publicEnv.PUBLIC_APP_TITLE?.trim() || buildOrgSiteTitle(orgName, metaCopy.heading),
    description:
      publicEnv.PUBLIC_APP_DESCRIPTION?.trim() ||
      metaCopy.description ||
      `Explore courses and training programs from ${orgName}.`,
    siteName: orgName
  };
}

function getFirstForwardedValue(value: string | null): string {
  return value?.split(',')[0]?.trim() ?? '';
}

export function resolvePublicRequestUrl(url: URL, headers: Headers): URL {
  const resolvedUrl = new URL(url);
  const forwardedHost = getFirstForwardedValue(headers.get('x-forwarded-host'));
  const forwardedProtocol = getFirstForwardedValue(headers.get('x-forwarded-proto'));

  if (!forwardedHost || (forwardedProtocol !== 'http' && forwardedProtocol !== 'https')) {
    return resolvedUrl;
  }

  try {
    const forwardedOrigin = new URL(`${forwardedProtocol}://${forwardedHost}`);
    if (
      forwardedOrigin.username ||
      forwardedOrigin.password ||
      forwardedOrigin.pathname !== '/' ||
      forwardedOrigin.search ||
      forwardedOrigin.hash
    ) {
      return resolvedUrl;
    }

    resolvedUrl.protocol = forwardedOrigin.protocol;
    resolvedUrl.host = forwardedOrigin.host;
  } catch (error) {
    console.error('resolvePublicRequestUrl error:', error);
  }

  return resolvedUrl;
}

export async function getBaseMetaTags(url: URL, headers: Headers, orgSiteInfo: OrgSiteInfo): Promise<MetaTagsProps> {
  const publicRequestUrl = resolvePublicRequestUrl(url, headers);
  const orgMeta = resolveOrgSiteMeta(orgSiteInfo);

  const title =
    orgMeta?.title ||
    publicEnv.PUBLIC_APP_TITLE?.trim() ||
    (isSelfHosted && orgSiteInfo.org?.name ? `${orgSiteInfo.org.name} | Learning Platform` : DEFAULT_TITLE);

  const description = orgMeta?.description || publicEnv.PUBLIC_APP_DESCRIPTION?.trim() || DEFAULT_DESCRIPTION;

  const siteName =
    orgMeta?.siteName ||
    publicEnv.PUBLIC_APP_TITLE?.trim() ||
    (isSelfHosted && orgSiteInfo.org?.name ? orgSiteInfo.org.name : null) ||
    PRODUCT_NAME;

  const ogImageUrl = await resolveOgImageUrl(publicRequestUrl, orgSiteInfo);
  const usesDynamicOrgOg =
    orgSiteInfo.isOrgSite && Boolean(orgSiteInfo.org?.siteName) && !publicEnv.PUBLIC_OG_IMAGE_URL?.trim();

  const openGraphImages = usesDynamicOrgOg
    ? buildOrgOpenGraphImages(ogImageUrl, siteName)
    : [
        {
          url: ogImageUrl,
          alt: `${siteName} platform for customer, partner, and employee education`,
          width: 1920,
          height: 1080,
          secureUrl: ogImageUrl.startsWith('https://') ? ogImageUrl : undefined,
          type: 'image/jpeg'
        },
        {
          url: ogImageUrl,
          alt: `${siteName} platform for customer, partner, and employee education`,
          width: 1920,
          height: 1080,
          secureUrl: ogImageUrl.startsWith('https://') ? ogImageUrl : undefined,
          type: 'image/webp'
        }
      ];

  const imageAlt = usesDynamicOrgOg
    ? `${siteName} learning platform`
    : `${siteName} platform for customer, partner, and employee education`;

  return Object.freeze({
    title,
    description,
    canonical: new URL(publicRequestUrl.pathname, publicRequestUrl.origin).href,
    openGraph: {
      type: 'website',
      url: new URL(publicRequestUrl.pathname, publicRequestUrl.origin).href,
      locale: 'en_US',
      title,
      description,
      siteName,
      images: openGraphImages
    },
    twitter: {
      handle: undefined,
      site: undefined,
      cardType: 'summary_large_image' as const,
      title,
      description,
      image: ogImageUrl,
      imageAlt
    }
  });
}
