import { classroomhub, type InferRequestType, type InferResponseType } from '$lib/utils/services/api';

export type GetOrganizationRequest = typeof classroomhub.organization.$get;
export type GetOrganizationResponse = InferResponseType<GetOrganizationRequest> | null;
export type GetOrganizationSuccess = Extract<InferResponseType<GetOrganizationRequest>, { success: true }>;
export type OrganizationRecord = GetOrganizationSuccess['data'][number];

export type QuizListRequest = (typeof classroomhub.organization)[':orgId']['quiz']['$get'];
export type QuizGetRequest = (typeof classroomhub.organization)[':orgId']['quiz'][':quizId']['$get'];
export type QuizCreateRequest = (typeof classroomhub.organization)[':orgId']['quiz']['$post'];
export type QuizUpdateRequest = (typeof classroomhub.organization)[':orgId']['quiz'][':quizId']['$put'];
export type QuizDeleteRequest = (typeof classroomhub.organization)[':orgId']['quiz'][':quizId']['$delete'];
export type QuizListSuccess = Extract<InferResponseType<QuizListRequest>, { success: true }>;
export type Quiz = QuizListSuccess['data'][number];
export type QuizCreateData = NonNullable<InferRequestType<QuizCreateRequest>['json']>;
export type QuizUpdateData = NonNullable<InferRequestType<QuizUpdateRequest>['json']>;

export type GetFirstOrganizationRequest = typeof classroomhub.organization.first.$get;
export type GetFirstOrganizationResponse = InferResponseType<GetFirstOrganizationRequest> | null;
export type GetFirstOrganizationSuccess = Extract<InferResponseType<GetFirstOrganizationRequest>, { success: true }>;
export type FirstOrganizationRecord = GetFirstOrganizationSuccess['data'][number];

export type JoinAcademyRequest = typeof classroomhub.organization.join.$post;

// Team member types
export type GetTeamRequest = (typeof classroomhub.organization)['team']['$get'];
export type OrganizationTeamResponse = InferResponseType<GetTeamRequest> | null;
export type OrganizationTeamSuccess = Extract<InferResponseType<GetTeamRequest>, { success: true }>;

export type OrganizationTeamMembersRaw = OrganizationTeamSuccess['data'];

// Mapped team members with role and isAdmin (mapped in API layer)
export type OrganizationTeamMembers = Array<
  OrganizationTeamMembersRaw[number] & {
    role: string;
    isAdmin: boolean;
    verified: boolean;
  }
>;

// Audience types
export type GetAudienceRequest = (typeof classroomhub.organization)['audience']['$get'];
export type OrganizationAudienceResponse = InferResponseType<GetAudienceRequest> | null;
export type OrganizationAudienceSuccess = Extract<InferResponseType<GetAudienceRequest>, { success: true }>;
export type OrganizationAudienceRequestQuery = NonNullable<InferRequestType<GetAudienceRequest>['query']>;
export type OrganizationAudienceSortBy = 'createdAt' | 'name' | 'email';
export type OrganizationAudienceSortOrder = 'asc' | 'desc';
export type OrganizationAudienceQuery = {
  page: number;
  limit: number;
  search?: string;
  sortBy: OrganizationAudienceSortBy;
  sortOrder: OrganizationAudienceSortOrder;
};

export type OrganizationAudience = OrganizationAudienceSuccess['data'];
export type OrganizationAudiencePagination = OrganizationAudienceSuccess['pagination'];
export type OrganizationAudienceMember = OrganizationAudience[number];

// Org Public Courses  types
export type GetOrgPublicCoursesRequest = typeof classroomhub.organization.courses.public.$get;
export type OrgPublicCoursesResponse = InferResponseType<GetOrgPublicCoursesRequest> | null;
export type OrgPublicCoursesSuccess = Extract<InferResponseType<GetOrgPublicCoursesRequest>, { success: true }>;
export type OrgPublicCoursesData = OrgPublicCoursesSuccess['data'];
export type OrgPublicCourses = OrgPublicCoursesData['courses'];
export type ReorderOrgCoursesRequest = (typeof classroomhub.organization.courses)['reorder']['$post'];
export type ReorderOrgCoursesBody = InferRequestType<ReorderOrgCoursesRequest>;

// dashboard analytics types
export type GetDashStatsRequest = typeof classroomhub.dash.stats.$get;
export type DashStatsResponse = InferResponseType<GetDashStatsRequest> | null;
export type DashStatsSuccess = Extract<InferResponseType<GetDashStatsRequest>, { success: true }>;

export type GetLoginActivityRequest = (typeof classroomhub.dash)['login-activity']['$get'];
export type LoginActivitySuccess = Extract<InferResponseType<GetLoginActivityRequest>, { success: true }>;
export type LoginActivityData = LoginActivitySuccess['data'];

// invite team types
export type InviteTeamRequest = (typeof classroomhub.organization)['team']['invite']['$post'];
export type InviteTeamSuccess = Extract<InferResponseType<InviteTeamRequest>, { success: true }>;
export type InviteTeamData = InviteTeamSuccess['data'];

export type DeleteTeamRequest = (typeof classroomhub.organization)['team'][':memberId']['$delete'];
export type DeleteTeamSuccess = Extract<InferResponseType<DeleteTeamRequest>, { success: true }>;
export type DeleteAudienceMemberRequest = (typeof classroomhub.organization)['audience'][':memberId']['$delete'];
export type DeleteAudienceMemberSuccess = Extract<InferResponseType<DeleteAudienceMemberRequest>, { success: true }>;

// update organization types
export type UpdateOrganizationRequest = (typeof classroomhub.organization)['$put'];
export type UpdateOrganizationResponse = InferResponseType<UpdateOrganizationRequest>;
export type UpdateOrganizationSuccess = Extract<UpdateOrganizationResponse, { success: true }>;

// domain request types
export type DomainRequestRequest = typeof classroomhub.domain.$post;
export type DomainRequestResponse = InferResponseType<DomainRequestRequest>;
export type DomainRequestSuccess = Extract<DomainRequestResponse, { success: true }>;
export type DomainRequestData = DomainRequestSuccess['data'];
export type DomainRequestStatus = DomainRequestData['status'];

// SSO types
export type GetSsoConfigRequest = (typeof classroomhub.organization)['sso']['$get'];
export type CreateSsoConnectionRequest = (typeof classroomhub.organization)['sso']['$post'];
export type UpdateSsoConnectionRequest = (typeof classroomhub.organization)['sso']['$put'];
export type DeleteSsoConnectionRequest = (typeof classroomhub.organization)['sso']['$delete'];
export type ActivateSsoConnectionRequest = (typeof classroomhub.organization)['sso']['activate']['$post'];
export type GetSsoPolicyRequest = (typeof classroomhub.organization)['sso']['policy']['$get'];
export type UpdateSsoPolicyRequest = (typeof classroomhub.organization)['sso']['policy']['$put'];

export type SsoDiscoveryRequest = typeof classroomhub.sso.discover.$get;
export type GetOrgSsoInfoRequest = (typeof classroomhub.sso)['org'][':orgId']['$get'];

export type GetSsoConfigSuccess = Extract<InferResponseType<GetSsoConfigRequest>, { success: true }>;
type SsoConfigData = NonNullable<GetSsoConfigSuccess['data']>;
type NormalizedPolicy = SsoConfigData extends { policy: infer P }
  ? P extends object
    ? Omit<P, 'roleMapping'> & { roleMapping: Record<string, number> }
    : null
  : null;
/** Normalized SSO config: API returns policy.roleMapping as JSONValue; this uses Record<string, number>. */
export type SsoConfig = {
  config: SsoConfigData['config'] | null;
  policy: NormalizedPolicy;
};

export type GetSsoDiscoverySuccess = Extract<InferResponseType<SsoDiscoveryRequest>, { success: true }>;
export type SsoDiscoveryResult = GetSsoDiscoverySuccess['data'];

export type GetOrgSsoInfoSuccess = Extract<InferResponseType<GetOrgSsoInfoRequest>, { success: true }>;
export type OrgSsoInfo = GetOrgSsoInfoSuccess['data'];

// Audience import types
export type ImportAudienceRequest = (typeof classroomhub.organization)['audience']['import']['$post'];
export type ImportAudienceSuccess = Extract<InferResponseType<ImportAudienceRequest>, { success: true }>;
export type ImportAudienceData = ImportAudienceSuccess['data'];

// Audience assign courses types
export type AssignAudienceCoursesRequest = (typeof classroomhub.organization)['audience']['assign-courses']['$post'];
export type AssignAudienceCoursesSuccess = Extract<InferResponseType<AssignAudienceCoursesRequest>, { success: true }>;
export type AssignAudienceCoursesData = AssignAudienceCoursesSuccess['data'];

// Audience invite actions
export type ResendAudienceInviteRequest = (typeof classroomhub.organization)['audience']['resend-invite']['$post'];
export type RevokeAudienceInviteRequest = (typeof classroomhub.organization)['audience']['revoke-invite']['$post'];

// Link invite types
export type GetLinkInviteRequest = (typeof classroomhub.organization)['link-invite']['$get'];
export type CreateLinkInviteRequest = (typeof classroomhub.organization)['link-invite']['$post'];
export type ToggleLinkInviteRequest = (typeof classroomhub.organization)['link-invite']['$patch'];

export type GetLinkInviteSuccess = Extract<InferResponseType<GetLinkInviteRequest>, { success: true }>;
export type OrgLinkInvite = GetLinkInviteSuccess['data'];

// Token auth types
export type CreateTokenAuthRequest = (typeof classroomhub.organization)['token-auth']['$post'];
export type GetTokenAuthRequest = (typeof classroomhub.organization)['token-auth']['$get'];
export type RotateTokenAuthRequest = (typeof classroomhub.organization)['token-auth']['rotate']['$post'];
export type DeleteTokenAuthRequest = (typeof classroomhub.organization)['token-auth']['$delete'];
export type ActivateTokenAuthRequest = (typeof classroomhub.organization)['token-auth']['activate']['$put'];
