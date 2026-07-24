import type { CommunityQuestionSuccess } from '$features/community/utils/types';
import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';

export const load = async ({ params, parent, cookies }) => {
  const { orgId } = await parent();
  const slug = params.cslug || '';

  const questionResult = await safeServerApi<CommunityQuestionSuccess>(() =>
    classroom.io.vnmunity[':slug'].$get({ param: { slug } }, getApiHeaders(cookies, orgId))
  );
  const question = questionResult.ok ? questionResult.body.data : null;

  return {
    slug,
    question
  };
};
