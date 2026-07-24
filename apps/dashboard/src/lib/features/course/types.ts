// Question type inferred from API Exercise response
import type { Course as CourseDetails, Exercise } from './utils/types';
import type { InferRequestType, InferResponseType } from '@cio/api/rpc-types';
import { classroomhub } from '$lib/utils/services/api';

// Org Courses types
export type GetOrgCoursesRequest = typeof classroomhub.organization.courses.$get;
export type OrgCoursesResponse = InferResponseType<GetOrgCoursesRequest> | null;
export type OrgCoursesSuccess = Extract<InferResponseType<GetOrgCoursesRequest>, { success: true }>;
export type GetOrgCoursesRequestQuery = NonNullable<InferRequestType<GetOrgCoursesRequest>['query']>;
export type OrgCourses = OrgCoursesSuccess['data'];
export type OrgCoursesPagination = OrgCoursesSuccess['pagination'];
export type OrgCoursesQuery = {
  page: number;
  limit: number;
  search?: string;
  tags?: string;
};

// User Enrolled Courses types
export type GetUserEnrolledCoursesRequest = typeof classroomhub.organization.courses.enrolled.$get;
export type UserEnrolledCoursesResponse = InferResponseType<GetUserEnrolledCoursesRequest> | null;
export type UserEnrolledCoursesSuccess = Extract<InferResponseType<GetUserEnrolledCoursesRequest>, { success: true }>;
export type UserEnrolledCourses = UserEnrolledCoursesSuccess['data'];

// Recommended Courses types
export type GetRecommendedCoursesRequest = typeof classroomhub.organization.courses.recommended.$get;
export type RecommendedCoursesResponse = InferResponseType<GetRecommendedCoursesRequest> | null;
export type RecommendedCoursesSuccess = Extract<InferResponseType<GetRecommendedCoursesRequest>, { success: true }>;
export type RecommendedCourses = RecommendedCoursesSuccess['data'];

// Get course types
export type GetCourseRequest = (typeof classroomhub.course)[':courseId']['$get'];
export type GetCourseResponse = InferResponseType<GetCourseRequest>;
export type GetCourseSuccess = Extract<GetCourseResponse, { success: true }>;
export type Course = CourseDetails;

// Base question type from API
type ApiQuestion = NonNullable<Exercise['questions']>[number];
type ApiOption = ApiQuestion['options'][number];

// Extended option type with client-side fields
type QuestionOption = ApiOption & {
  isDirty?: boolean;
};

// Extended question type with client-side fields
export type Question = Omit<ApiQuestion, 'options'> & {
  exerciseSectionId?: string | null;
  isDirty?: boolean;
  deletedAt?: string;
  options: QuestionOption[];
  settings?: Record<string, unknown>;
};
