import type { MetaTagsProps } from 'svelte-meta-tags';
import { ensureTranslations, localeFromPath, pathInLocale, t } from '$lib/i18n';
import { PRODUCT_ROOT_DOMAIN } from '@cio/utils/constants';
import { get } from 'svelte/store';

export const prerender = true;

export async function load({ url }) {
  const locale = localeFromPath(url.pathname);

  // Before the meta tags are read: their wording comes from the same catalogue.
  await ensureTranslations(locale);

  return {
    locale,
    baseMetaTags: getBaseMetaTags(url, locale),
    url: url.pathname
  };
}

const DEFAULT_OG_IMAGE_URL = '/assets/brand/og/classroomhub-opengraph.jpg';

/**
 * Prerendering runs against the placeholder origin `http://sveltekit-prerender`,
 * so `url.origin` bakes that string into every canonical and `hreflang` in the
 * built HTML. Search engines read those as real URLs. The public origin is a
 * constant, so use it.
 */
const SITE_ORIGIN = `https://${PRODUCT_ROOT_DOMAIN}`;

function absolute(pathname: string): string {
  return new URL(pathname, SITE_ORIGIN).href;
}

function getBaseMetaTags(url: URL, locale: string) {
  const translate = get(t);
  const title = translate('meta.title');
  const description = translate('meta.description');
  const imageAlt = translate('meta.og_alt');
  const canonicalUrl = absolute(url.pathname);

  // Each page exists in both languages; without these Google picks one and drops
  // the other as a duplicate.
  const languageAlternates = [
    { hrefLang: 'vi', href: absolute(pathInLocale(url.pathname, 'vi')) },
    { hrefLang: 'en', href: absolute(pathInLocale(url.pathname, 'en')) },
    { hrefLang: 'x-default', href: absolute(pathInLocale(url.pathname, 'vi')) }
  ];

  const metatags = Object.freeze({
    title,
    description,
    canonical: canonicalUrl,
    languageAlternates,
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      locale: locale === 'vi' ? 'vi_VN' : 'en_US',
      title,
      description,
      siteName: 'ClassroomHub',
      images: [
        {
          url: absolute(DEFAULT_OG_IMAGE_URL),
          alt: imageAlt,
          width: 1200,
          height: 630,
          secureUrl: absolute(DEFAULT_OG_IMAGE_URL),
          type: 'image/jpeg'
        },
        {
          url: absolute('/assets/brand/og/classroomhub-opengraph.webp'),
          alt: imageAlt,
          width: 1200,
          height: 630,
          secureUrl: absolute('/assets/brand/og/classroomhub-opengraph.webp'),
          type: 'image/webp'
        }
      ]
    },
    twitter: {
      handle: '@Tedydev_web',
      site: '@Tedydev_web',
      cardType: 'summary_large_image' as const,
      title,
      description,
      image: absolute(DEFAULT_OG_IMAGE_URL),
      imageAlt
    }
  }) satisfies MetaTagsProps;

  return metatags;
}
