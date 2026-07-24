import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type GenerateTextRequest = (typeof classroomhub.agent)['generate-text']['$post'];
export type GenerateTextSuccess = Extract<InferResponseType<GenerateTextRequest>, { success: true }>;
