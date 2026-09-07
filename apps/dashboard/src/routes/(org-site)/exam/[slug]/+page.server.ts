import { error } from '@sveltejs/kit';

import { classroomhub } from '$lib/utils/services/api';
import { getApiKeyHeaders, safeServerApi } from '$lib/utils/services/api/server';
import { examPreviewDescription, examPreviewTitle } from '$features/exam/exam-link-preview';
import { resolvePublicRequestUrl } from '$lib/utils/functions/metaTags.server';

/**
 * Loads only what the entry screen needs: the paper's title and which details it asks a
 * sitter to declare.
 *
 * The questions are deliberately not loaded here. They arrive from the start call, once a
 * sitter has identified themselves and the server has opened an attempt with a clock —
 * otherwise the paper could be read without ever starting one.
 */
export const load = async ({ params, url, request }) => {
  const result = await safeServerApi(() =>
    classroomhub['exam-sitting'][':slug'].$get({ param: { slug: params.slug } }, getApiKeyHeaders())
  );

  if (!result.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  const exam = result.body.data;
  const publicRequestUrl = resolvePublicRequestUrl(url, request.headers);
  const canonical = new URL(publicRequestUrl.pathname, publicRequestUrl.origin).href;

  const title = examPreviewTitle({ title: exam.title, course: exam.course ?? null } as never);
  const description = examPreviewDescription({
    title: exam.title,
    course: exam.course ?? null,
    opensAt: exam.opensAt ?? null,
    closesAt: exam.closesAt ?? null,
    workingSeconds: exam.workingSeconds ?? null,
    questionCount: exam.questionCount ?? 0,
    requiresPassword: Boolean(exam.requiresPassword)
  });

  /**
   * A link to a paper previewed as the platform's own marketing — its logo, its tagline,
   * and nothing about which exam it was. A class receiving that in a group chat had to open
   * it to learn whether it was theirs.
   *
   * It deliberately sets no `robots` directive. It carried `noindex, nofollow` for a while,
   * on the reasoning that the address is the credential — but that reasoning weighed a
   * theoretical exposure against a certain cost, and got the trade the wrong way round.
   *
   * A crawler can only index an address it has found, and this one lives in the group chat a
   * teacher pasted it into. Where somebody does paste it somewhere public, it is public
   * already and no meta tag recalls it. Meanwhile several link scrapers refuse to draw a
   * picture for a page marked `noindex`, so the card lost its image the moment the directive
   * first took effect — a preview a whole class actually looks at, traded for a search result
   * nobody was going to get.
   *
   * Worth stating plainly: the directive never reached production. A frozen-object merge
   * swallowed every top-level tag from the day this shipped, so the pages have served
   * `index,follow` throughout. Leaving it out is the state that has been running all along.
   */
  /**
   * The paper's own wording over the platform's picture.
   *
   * The image stays the product's, deliberately: the alternative is a card drawn from the
   * organisation's name and tagline, and a generated picture of a school is not the school's
   * mark. A recognisable logo above the paper's own title reads better than an invented one.
   *
   * The Twitter block is set beside the Open Graph one rather than left to the base. A
   * scraper that prefers `twitter:` tags reads them first, and left alone they carried the
   * platform's own title and description over the paper's. Only the two lines are set here,
   * so the picture still comes from the base tags.
   */
  const pageMetaTags = Object.freeze({
    title,
    description,
    canonical,
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      description
    },
    twitter: {
      cardType: 'summary_large_image' as const,
      title,
      description
    }
  });

  return { exam, slug: params.slug, pageMetaTags };
};
