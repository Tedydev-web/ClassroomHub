import { hc } from 'hono/client';
import { Hono } from '@api/utils/hono';
import { accountRouter } from '@api/routes/account';
import { agentRouter } from '@api/routes/agent';
import { cohortRouter } from '@api/routes/cohort';
import { communityRouter } from '@api/routes/community';
import { courseRouter } from '@api/routes/course';
import { dashAnalyticsRouter } from '@api/routes/dash';
import { domainRouter } from '@api/routes/domain/domain';
import { hlsRouter } from '@api/routes/hls';
import { inviteRouter } from '@api/routes/invite';
import { jobsRouter } from '@api/routes/jobs';
import { mailRouter } from '@api/routes/mail';
import { mediaRouter } from '@api/routes/media';
import { notificationRouter } from '@api/routes/notification';
import { onboardingRouter } from '@api/routes/onboarding';
import { organizationRouter } from '@api/routes/organization';
import { publicCourseRouter } from '@api/routes/org-site';
import { reportRouter } from '@api/routes/report';
import { ssoDiscoveryRouter } from '@api/routes/sso/discovery';
import { examRouter } from '@api/routes/exam';
import { transcriptsRouter } from '@api/routes/transcripts';
import { unsplashRouter } from '@api/routes/unsplash/unsplash';

const accountRpc = new Hono().route('/account', accountRouter);
const agentRpc = new Hono().route('/agent', agentRouter);
const cohortRpc = new Hono().route('/cohort', cohortRouter);
const communityRpc = new Hono().route('/community', communityRouter);
const courseRpc = new Hono().route('/course', courseRouter);
const dashRpc = new Hono().route('/dash', dashAnalyticsRouter);
const domainRpc = new Hono().route('/domain', domainRouter);
const hlsRpc = new Hono().route('/hls', hlsRouter);
const inviteRpc = new Hono().route('/invite', inviteRouter);
const jobsRpc = new Hono().route('/jobs', jobsRouter);
const mailRpc = new Hono().route('/mail', mailRouter);
const mediaRpc = new Hono().route('/media', mediaRouter);
const notificationsRpc = new Hono().route('/notifications', notificationRouter);
const onboardingRpc = new Hono().route('/onboarding', onboardingRouter);
const organizationRpc = new Hono().route('/organization', organizationRouter);
const publicCourseRpc = new Hono().route('/org-site/course', publicCourseRouter);
const reportRpc = new Hono().route('/report', reportRouter);
const ssoRpc = new Hono().route('/sso', ssoDiscoveryRouter);
const examRpc = new Hono().route('/exam', examRouter);
const transcriptsRpc = new Hono().route('/transcripts', transcriptsRouter);
const unsplashRpc = new Hono().route('/unsplash', unsplashRouter);

export type Client = ReturnType<typeof hc<typeof accountRpc>> &
  ReturnType<typeof hc<typeof agentRpc>> &
  ReturnType<typeof hc<typeof cohortRpc>> &
  ReturnType<typeof hc<typeof communityRpc>> &
  ReturnType<typeof hc<typeof courseRpc>> &
  ReturnType<typeof hc<typeof dashRpc>> &
  ReturnType<typeof hc<typeof domainRpc>> &
  ReturnType<typeof hc<typeof hlsRpc>> &
  ReturnType<typeof hc<typeof inviteRpc>> &
  ReturnType<typeof hc<typeof jobsRpc>> &
  ReturnType<typeof hc<typeof mailRpc>> &
  ReturnType<typeof hc<typeof mediaRpc>> &
  ReturnType<typeof hc<typeof notificationsRpc>> &
  ReturnType<typeof hc<typeof onboardingRpc>> &
  ReturnType<typeof hc<typeof organizationRpc>> &
  ReturnType<typeof hc<typeof publicCourseRpc>> &
  ReturnType<typeof hc<typeof reportRpc>> &
  ReturnType<typeof hc<typeof ssoRpc>> &
  ReturnType<typeof hc<typeof examRpc>> &
  ReturnType<typeof hc<typeof transcriptsRpc>> &
  ReturnType<typeof hc<typeof unsplashRpc>>;
