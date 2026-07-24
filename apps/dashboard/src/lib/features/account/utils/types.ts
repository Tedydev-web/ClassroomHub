import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type ListAccountWorkspacesRequest = typeof classroomhub.account.workspaces.$get;
export type CreateAccountWorkspaceRequest = typeof classroomhub.account.workspaces.$post;
export type DeleteAccountWorkspaceRequest = (typeof classroomhub.account.workspaces)[':workspaceId']['$delete'];
export type GetAccountUsageRequest = typeof classroomhub.account.usage.$get;
export type ViewAsStudentTokenRequest = (typeof classroomhub.account)['view-as-student-token']['$post'];

type ListSuccess = Extract<InferResponseType<ListAccountWorkspacesRequest>, { success: true }>;
type UsageSuccess = Extract<InferResponseType<GetAccountUsageRequest>, { success: true }>;

export type AccountWorkspaceList = ListSuccess['data']['workspaces'];
export type AccountWorkspaceLimits = ListSuccess['data']['limits'];
export type AccountWorkspace = AccountWorkspaceList[number];
export type AccountUsage = UsageSuccess['data'];
