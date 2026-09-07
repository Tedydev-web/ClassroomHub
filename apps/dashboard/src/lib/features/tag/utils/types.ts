import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type GetTagGroupsRequest = (typeof classroomhub.organization)['tags']['$get'];
export type GetTagGroupsResponse = InferResponseType<GetTagGroupsRequest>;
export type GetTagGroupsSuccess = Extract<GetTagGroupsResponse, { success: true }>;
export type OrganizationTagGroups = GetTagGroupsSuccess['data'];
export type OrganizationTagGroup = OrganizationTagGroups[number];
export type OrganizationTag = OrganizationTagGroup['tags'][number];

export type CreateTagGroupRequest = (typeof classroomhub.organization)['tags']['groups']['$post'];
export type UpdateTagGroupRequest = (typeof classroomhub.organization)['tags']['groups'][':groupId']['$put'];
export type CreateTagRequest = (typeof classroomhub.organization)['tags']['$post'];
export type UpdateTagRequest = (typeof classroomhub.organization)['tags'][':tagId']['$put'];

export type CreateTagGroupResponse = InferResponseType<CreateTagGroupRequest>;
export type CreatedTagGroup = Extract<CreateTagGroupResponse, { success: true }>['data'];

export type CreateTagResponse = InferResponseType<CreateTagRequest>;
export type CreatedTag = Extract<CreateTagResponse, { success: true }>['data'];

export type GetCourseTagsRequest = (typeof classroomhub.course)[':courseId']['tags']['$get'];
export type UpdateCourseTagsRequest = (typeof classroomhub.course)[':courseId']['tags']['$put'];
export type GetCourseTagsResponse = InferResponseType<GetCourseTagsRequest>;
export type GetCourseTagsSuccess = Extract<GetCourseTagsResponse, { success: true }>;
export type OrganizationCourseTags = GetCourseTagsSuccess['data'];
