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
   * `noindex` because the address is the credential: the paper is reachable by anybody who
   * has the link, and a search engine that has it would hand it to everybody who does not.
   * A chat app scraping the page to draw a card is welcome; an index of open exams is not.
   */
  const pageMetaTags = Object.freeze({
    title,
    description,
    canonical,
    robots: 'noindex, nofollow',
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      description
    }
  });

  return { exam, slug: params.slug, pageMetaTags };
};
