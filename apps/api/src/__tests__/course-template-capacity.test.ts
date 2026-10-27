import { beforeEach, describe, expect, it, vi } from 'vitest';

const deployment = vi.hoisted(() => ({ full: false }));

vi.mock('@cio/core/config/deployment', () => ({
  get hasFullProductEntitlements() {
    return deployment.full;
  }
}));
vi.mock('@db/drizzle', () => ({
  db: { transaction: vi.fn((run: (tx: unknown) => unknown) => run({})) }
}));
vi.mock('@db/queries', () => ({
  countCourseStudents: vi.fn(),
  countOrgTemplates: vi.fn(),
  canUseCourseTemplate: vi.fn(),
  getCourseById: vi.fn(),
  getCourseOrganizationId: vi.fn(),
  getCourseSectionsByCourseId: vi.fn(),
  getExercisesByCourseId: vi.fn(),
  getLessonsByCourseId: vi.fn(),
  getQuestionsByExerciseIds: vi.fn(),
  listGlobalTemplateCards: vi.fn(),
  listOrgTemplateCards: vi.fn(),
  listTemplateHighlights: vi.fn(),
  lockOrganizationForUpdate: vi.fn(),
  updateCourse: vi.fn()
}));
vi.mock('@cio/db/queries/organization', () => ({ getActiveOrganizationPlan: vi.fn() }));
vi.mock('@cio/core/utils/redis/org-stats-cache', () => ({ invalidateOrgStats: vi.fn() }));
vi.mock('@cio/core/services/posthog', () => ({ capturePlanLimitReached: vi.fn() }));
vi.mock('@cio/core/services/course/landing-page', () => ({ generateUniqueCourseSlug: vi.fn() }));
vi.mock('@api/services/course/clone', () => ({ cloneCourse: vi.fn() }));

import {
  countCourseStudents,
  countOrgTemplates,
  getCourseById,
  getCourseOrganizationId,
  updateCourse
} from '@db/queries';
import { getActiveOrganizationPlan } from '@cio/db/queries/organization';
import { convertCourseToTemplate } from '@api/services/course/course-template';

const ORG_ID = 'org-1';
const COURSE_ID = 'course-1';

describe('template capacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCourseById).mockResolvedValue([{ id: COURSE_ID, status: 'ACTIVE', isTemplate: false }] as never);
    vi.mocked(getCourseOrganizationId).mockResolvedValue(ORG_ID as never);
    vi.mocked(countCourseStudents).mockResolvedValue(0 as never);
    vi.mocked(getActiveOrganizationPlan).mockResolvedValue(null as never);
    vi.mocked(countOrgTemplates).mockResolvedValue(5 as never);
    vi.mocked(updateCourse).mockResolvedValue({ id: COURSE_ID, isTemplate: true } as never);
  });

  it('refuses another template on an organization without a plan', async () => {
    deployment.full = false;

    await expect(convertCourseToTemplate(COURSE_ID, ORG_ID)).rejects.toMatchObject({ statusCode: 403 });
    expect(updateCourse).not.toHaveBeenCalled();
  });

  it('allows any number of templates when the deployment has every feature', async () => {
    deployment.full = true;

    await expect(convertCourseToTemplate(COURSE_ID, ORG_ID)).resolves.toMatchObject({ isTemplate: true });
    expect(updateCourse).toHaveBeenCalledOnce();
  });
});
