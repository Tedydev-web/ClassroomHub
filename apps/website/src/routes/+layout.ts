import type { MetaTagsProps } from 'svelte-meta-tags';

export const prerender = true;

export async function load({ url }) {
  return {
    baseMetaTags: getBaseMetaTags(url),
    url: url.pathname
  };
}

const DEFAULT_META_TITLE = 'ClassroomHub | One Platform to Teach Anything, to Anyone';
const DEFAULT_META_DESCRIPTION =
  'Train staff, educate customers, certify partners, or sell courses to the public. Build with AI, publish under your own domain, and track every completion.';
const DEFAULT_OG_IMAGE_URL = '/assets/brand/og/classroomhub-opengraph.jpg';
const DEFAULT_OG_IMAGE_ALT = 'ClassroomHub, one platform to teach anything to anyone';

function getBaseMetaTags(url: URL) {
  const canonicalUrl = new URL(url.pathname, url.origin).href;

  const metatags = Object.freeze({
    title: DEFAULT_META_TITLE,
    description: DEFAULT_META_DESCRIPTION,
    canonical: canonicalUrl,
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      locale: 'en_US',
      title: DEFAULT_META_TITLE,
      description: DEFAULT_META_DESCRIPTION,
      siteName: 'ClassroomHub',
      images: [
        {
          url: '/assets/brand/og/classroomhub-opengraph.jpg',
          alt: DEFAULT_OG_IMAGE_ALT,
          width: 1200,
          height: 630,
          secureUrl: '/assets/brand/og/classroomhub-opengraph.jpg',
          type: 'image/jpeg'
        },
        {
          url: '/assets/brand/og/classroomhub-opengraph.webp',
          alt: DEFAULT_OG_IMAGE_ALT,
          width: 1200,
          height: 630,
          secureUrl: '/assets/brand/og/classroomhub-opengraph.webp',
          type: 'image/webp'
        }
      ]
    },
    twitter: {
      handle: '@Tedydev_web',
      site: '@Tedydev_web',
      cardType: 'summary_large_image' as const,
      title: DEFAULT_META_TITLE,
      description: DEFAULT_META_DESCRIPTION,
      image: '/assets/brand/og/classroomhub-opengraph.jpg',
      imageAlt: DEFAULT_OG_IMAGE_ALT
    }
  }) satisfies MetaTagsProps;

  return metatags;
}
