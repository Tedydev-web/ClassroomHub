import type { InferResponseType } from '$lib/utils/services/api';
import { classroomhub, getApiHeaders } from '$lib/utils/services/api';
import { safeServerApi } from '$lib/utils/services/api/server';
import { getAudienceQueryFromSearchParams, toAudienceRequestQuery } from '$lib/features/org/utils/audience-query-utils';
import type { OrganizationAudienceSuccess } from '$lib/features/org/utils/types';
import { error } from '@sveltejs/kit';

type GetOrganizationCoursesRequest = typeof classroomhub.organization.courses.$get;
type GetOrganizationCoursesSuccess = Extract<InferResponseType<GetOrganizationCoursesRequest>, { success: true }>;

export const load = async ({ parent, cookies, url }) => {
  const { orgId } = await parent();

  if (!orgId) {
    throw error(404, 'Audience not found');
  }

  const headers = getApiHeaders(cookies, orgId);
  const query = getAudienceQueryFromSearchParams(url.searchParams);

  const [audienceResult, coursesResult] = await Promise.all([
    safeServerApi<OrganizationAudienceSuccess>(() =>
      classroomhub.organization.audience.$get({ query: toAudienceRequestQuery(query)! }, headers)
    ),
    safeServerApi<GetOrganizationCoursesSuccess>(() =>
      classroomhub.organization.courses.$get({ query: { tags: undefined } }, headers)
    )
  ]);

  if (!audienceResult.ok) {
    if (audienceResult.status === 403 || audienceResult.status === 404) {
      throw error(404, 'Audience not found');
    }

    throw error(500, audienceResult.message);
  }

  const audience = audienceResult.body.data;
  const pagination = audienceResult.body.pagination;
  const courses = coursesResult.ok ? coursesResult.body.data : [];

  return {
    audience,
    pagination,
    query,
    courses
  };
};
