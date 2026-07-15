import type { MetaTagsProps } from 'svelte-meta-tags';

export const prerender = true;

export async function load({ data, url }) {
  return {
    stars: data.stars,
    baseMetaTags: getBaseMetaTags(url),
    url: url.pathname
  };
}

const DEFAULT_META_TITLE = 'Classroom | One Platform for Customer, Partner, and Employee Training';
const DEFAULT_META_DESCRIPTION =
  'One platform for customer academies, partner certification, and employee training. Build courses with AI, publish under your domain, and track completions.';
const DEFAULT_OG_IMAGE_URL = '/assets/brand/og/classroomio-opengraph.jpg';
const DEFAULT_OG_IMAGE_ALT = 'Classroom platform for customer, partner, and employee education';

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
      siteName: 'Classroom',
      images: [
        {
          url: '/assets/brand/og/classroomio-opengraph.jpg',
          alt: DEFAULT_OG_IMAGE_ALT,
          width: 1920,
          height: 1080,
          secureUrl: '/assets/brand/og/classroomio-opengraph.jpg',
          type: 'image/jpeg'
        },
        {
          url: '/assets/brand/og/classroomio-opengraph.webp',
          alt: DEFAULT_OG_IMAGE_ALT,
          width: 1920,
          height: 1080,
          secureUrl: '/assets/brand/og/classroomio-opengraph.webp',
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
      image: '/assets/brand/og/classroomio-opengraph.jpg',
      imageAlt: DEFAULT_OG_IMAGE_ALT
    }
  }) satisfies MetaTagsProps;

  return metatags;
}
