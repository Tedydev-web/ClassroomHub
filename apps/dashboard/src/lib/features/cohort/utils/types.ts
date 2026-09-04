import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

type CohortListResponse = InferResponseType<typeof classroomhub.cohort.$get>;
type CohortListSuccess = Extract<CohortListResponse, { success: true }>;
export type Cohort = CohortListSuccess['data'][number];

type CohortResponse = InferResponseType<(typeof classroomhub.cohort)[':cohortId']['$get']>;
type CohortSuccess = Extract<CohortResponse, { success: true }>;
export type CohortDetail = CohortSuccess['data'];

type CohortMembersResponse = InferResponseType<(typeof classroomhub.cohort)[':cohortId']['members']['$get']>;
type CohortMembersSuccess = Extract<CohortMembersResponse, { success: true }>;
export type CohortMember = CohortMembersSuccess['data'][number];

type CohortCoursesResponse = InferResponseType<(typeof classroomhub.cohort)[':cohortId']['courses']['$get']>;
type CohortCoursesSuccess = Extract<CohortCoursesResponse, { success: true }>;
export type CohortCourse = CohortCoursesSuccess['data'][number];

export type ListCohortNewsfeedRequest = (typeof classroomhub.cohort)[':cohortId']['newsfeed']['$get'];
type ListCohortNewsfeedResponse = InferResponseType<ListCohortNewsfeedRequest>;
type ListCohortNewsfeedSuccess = Extract<ListCohortNewsfeedResponse, { success: true }>;
export type CohortNewsfeed = ListCohortNewsfeedSuccess['data'];
export type ListCohortNewsfeed = CohortNewsfeed['items'];
export type CohortNewsfeedItem = ListCohortNewsfeed[number];

export type CreateCohortNewsfeedRequest = (typeof classroomhub.cohort)[':cohortId']['newsfeed']['$post'];
export type UpdateCohortNewsfeedRequest = (typeof classroomhub.cohort)[':cohortId']['newsfeed'][':feedId']['$put'];
export type ReactToCohortNewsfeedRequest =
  (typeof classroomhub.cohort)[':cohortId']['newsfeed'][':feedId']['react']['$put'];
export type DeleteCohortNewsfeedRequest = (typeof classroomhub.cohort)[':cohortId']['newsfeed'][':feedId']['$delete'];

export type GetCohortNewsfeedCommentsRequest =
  (typeof classroomhub.cohort)[':cohortId']['newsfeed'][':feedId']['comments']['$get'];
type GetCohortNewsfeedCommentsResponse = InferResponseType<GetCohortNewsfeedCommentsRequest>;
type GetCohortNewsfeedCommentsSuccess = Extract<GetCohortNewsfeedCommentsResponse, { success: true }>;
export type CohortNewsfeedCommentsResponse = GetCohortNewsfeedCommentsSuccess['data'];
export type CohortNewsfeedComment = CohortNewsfeedCommentsResponse[number];

export type CreateCohortNewsfeedCommentRequest =
  (typeof classroomhub.cohort)[':cohortId']['newsfeed'][':feedId']['comment']['$post'];
export type DeleteCohortNewsfeedCommentRequest =
  (typeof classroomhub.cohort)[':cohortId']['newsfeed'][':feedId']['comment'][':commentId']['$delete'];

// ─── Goals ───────────────────────────────────────────────────────────────────

export type ListCohortGoalsRequest = (typeof classroomhub.cohort)[':cohortId']['goals']['$get'];
type ListCohortGoalsResponse = InferResponseType<ListCohortGoalsRequest>;
type ListCohortGoalsSuccess = Extract<ListCohortGoalsResponse, { success: true }>;
export type CohortGoal = ListCohortGoalsSuccess['data'][number];
export type CohortGoalStatusCounts = CohortGoal['statusCounts'];

export type CreateCohortGoalRequest = (typeof classroomhub.cohort)[':cohortId']['goals']['$post'];
export type UpdateCohortGoalRequest = (typeof classroomhub.cohort)[':cohortId']['goals'][':goalId']['$put'];
export type DeleteCohortGoalRequest = (typeof classroomhub.cohort)[':cohortId']['goals'][':goalId']['$delete'];

export type MyGoalsRequest = typeof classroomhub.cohort.my.goals.$get;
type MyGoalsResponse = InferResponseType<MyGoalsRequest>;
type MyGoalsSuccess = Extract<MyGoalsResponse, { success: true }>;
export type MyGoalAssignment = MyGoalsSuccess['data'][number];

export type GoalsOverviewRequest = typeof classroomhub.cohort.goals.overview.$get;
type GoalsOverviewResponse = InferResponseType<GoalsOverviewRequest>;
type GoalsOverviewSuccess = Extract<GoalsOverviewResponse, { success: true }>;
export type GoalsOverview = GoalsOverviewSuccess['data'];
export type GoalsOverviewRow = GoalsOverview['goals'][number];

export type GetCohortInviteLinkRequest = (typeof classroomhub.cohort)[':cohortId']['invite-link']['$get'];
export type CreateCohortInviteLinkRequest = (typeof classroomhub.cohort)[':cohortId']['invite-link']['$post'];
export type ToggleCohortInviteLinkRequest = (typeof classroomhub.cohort)[':cohortId']['invite-link']['$patch'];
type GetCohortInviteLinkSuccess = Extract<InferResponseType<GetCohortInviteLinkRequest>, { success: true }>;
export type CohortInviteLink = GetCohortInviteLinkSuccess['data'];
