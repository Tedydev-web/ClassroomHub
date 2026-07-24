import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type AccountResponse = InferResponseType<typeof classroomhub.account.$get> | null;

export type AccountSuccess = Extract<InferResponseType<typeof classroomhub.account.$get>, { success: true }>;

export type AccountOrg = AccountSuccess['organizations'][number];
