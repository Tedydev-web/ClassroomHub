import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type UpdateProfileRequest = typeof classroomhub.account.profile.$put;
export type UpdateProfileSuccess = Extract<InferResponseType<UpdateProfileRequest>, { success: true }>;
export type UpdateProfileResponseProfile = UpdateProfileSuccess['profile'];

export type GetUsageRequest = typeof classroomhub.agent.usage.$get;
export type GetPurchasedRequest = (typeof classroomhub.agent.usage)['purchased']['$get'];
export type GetLeaderboardRequest = (typeof classroomhub.agent.usage)['leaderboard']['$get'];

type GetUsageSuccess = Extract<InferResponseType<GetUsageRequest>, { success: true }>;
type GetPurchasedSuccess = Extract<InferResponseType<GetPurchasedRequest>, { success: true }>;
type GetLeaderboardSuccess = Extract<InferResponseType<GetLeaderboardRequest>, { success: true }>;

export type AiUsageData = GetUsageSuccess['data'];
export type PurchasedSummaryData = GetPurchasedSuccess['data'];
export type LeaderboardData = GetLeaderboardSuccess['data'];
export type LeaderboardEntry = LeaderboardData['entries'][number];

export type GetMemberEmailNotificationsRequest =
  (typeof classroomhub.organization.member)['email-notifications']['$get'];
export type UpdateMemberEmailNotificationsRequest =
  (typeof classroomhub.organization.member)['email-notifications']['$put'];

export type GetMemberEmailNotificationsSuccess = Extract<
  InferResponseType<GetMemberEmailNotificationsRequest>,
  { success: true }
>;
export type MemberEmailNotificationPreferences = GetMemberEmailNotificationsSuccess['data'];
