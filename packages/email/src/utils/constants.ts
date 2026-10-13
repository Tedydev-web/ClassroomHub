import { env } from '../config/env';
import { OPERATOR_EMAIL, PRODUCT_NAME } from '@cio/utils/constants';

export const EMAIL_IDS = [
  'forgotPassword',
  'inviteTeacher',
  'newsfeedComment',
  'newsfeedPost',
  'onPasswordReset',
  'cohortGoalReminder',
  'quizAssigned',
  'sessionReminder',
  'sessionUpdated',
  'submissionGraded',
  'submissionReceived',
  'earlyAdopterReady',
  'earlyAdopterReminder',
  'studentLimitReached',
  'studentLimitApproaching',
  'contentReportAlert',
  'studentCourseInvite',
  'studentCourseCompletion',
  'studentCourseWelcome',
  'studentOrgInvite',
  'studentCohortWelcome',
  'studentProvePayment',
  'teacherCourseWelcome',
  'teacherStudentBuyRequest',
  'teacherStudentJoined',
  'verifyEmail',
  'welcome'
] as const;

const DEFAULT_EMAIL_FROM = `"${PRODUCT_NAME}" <${OPERATOR_EMAIL}>`;

export const EMAIL_FROM = env.SMTP_SENDER || DEFAULT_EMAIL_FROM;
export const EMAIL_REPLY_TO = `"${PRODUCT_NAME}" <${OPERATOR_EMAIL}>`;
