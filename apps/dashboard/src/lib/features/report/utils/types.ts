import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type CreateContentReportRequest = typeof classroomhub.report.$post;
export type CreateContentReportSuccess = Extract<InferResponseType<CreateContentReportRequest>, { success: true }>;
export type CreateContentReportData = CreateContentReportSuccess['data'];
