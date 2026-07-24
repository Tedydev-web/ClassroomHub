import type { MetaTagsProps } from 'svelte-meta-tags';

import { resolvePublicRequestUrl } from '$lib/utils/functions/metaTags.server';
import { classroomhub, type InferResponseType } from '$lib/utils/services/api';
import { getApiKeyHeaders, safeServerApi } from '$lib/utils/services/api/server';
import { error } from '@sveltejs/kit';

type GetPublicCourseItemRequest =
  (typeof classroomhub)['org-site']['course'][':courseSlug']['item'][':itemSlug']['$get'];
type GetPublicCourseItemSuccess = Extract<InferResponseType<GetPublicCourseItemRequest>, { success: true }>;

export const load = async ({ params = { slug: '', itemSlug: '' }, url, parent, request }) => {
  const { tree } = await parent();

  const itemResult = await safeServerApi<GetPublicCourseItemSuccess>(() =>
    classroomhub['org-site'].course[':courseSlug'].item[':itemSlug'].$get(
      { param: { courseSlug: params.slug, itemSlug: params.itemSlug } },
      getApiKeyHeaders()
    )
  );

  if (!itemResult.ok) {
    throw error(404, 'Public course or lesson not found');
  }

  const item = itemResult.body.data;

  const itemTitle = 'title' in item ? item.title : tree.course.title;
  const itemSummary =
    item.kind === 'lesson' && typeof item.body === 'string'
      ? item.body.replace(/<[^>]+>/g, '').slice(0, 155)
      : (tree.course.description ?? '');

  const publicRequestUrl = resolvePublicRequestUrl(url, request.headers);
  const canonicalUrl = new URL(publicRequestUrl.pathname, publicRequestUrl.origin).href;
  const fullTitle = `${itemTitle} · ${tree.course.title}`;
  const description = itemSummary || tree.course.description || '';
  const ogImage = tree.course.bannerImage || null;

  const pageMetaTags = Object.freeze({
    title: fullTitle,
    description,
    canonical: canonicalUrl,
    openGraph: {
      type: 'article',
      url: canonicalUrl,
      title: itemTitle,
      description,
      images: ogImage
        ? [
            {
              url: ogImage,
              alt: tree.course.title,
              width: 1200,
              height: 630,
              secureUrl: ogImage,
              type: 'image/jpeg'
            }
          ]
        : []
    },
    twitter: {
      handle: '@Tedydev_web',
      site: '@Tedydev_web',
      cardType: 'summary_large_image' as const,
      title: fullTitle,
      description,
      image: ogImage ?? undefined,
      imageAlt: tree.course.title
    }
  }) satisfies MetaTagsProps;

  return {
    item,
    pageMetaTags
  };
};
