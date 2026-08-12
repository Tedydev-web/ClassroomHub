import { error } from '@sveltejs/kit';

import { classroomhub } from '$lib/utils/services/api';
import { getApiKeyHeaders, safeServerApi } from '$lib/utils/services/api/server';

/**
 * Loads only what the entry screen needs: the paper's title and which details it asks a
 * sitter to declare.
 *
 * The questions are deliberately not loaded here. They arrive from the start call, once a
 * sitter has identified themselves and the server has opened an attempt with a clock —
 * otherwise the paper could be read without ever starting one.
 */
export const load = async ({ params }) => {
  const result = await safeServerApi(() =>
    classroomhub['exam-sitting'][':slug'].$get({ param: { slug: params.slug } }, getApiKeyHeaders())
  );

  if (!result.ok) {
    throw error(404, 'Không tìm thấy đề thi này');
  }

  return { exam: result.body.data, slug: params.slug };
};
