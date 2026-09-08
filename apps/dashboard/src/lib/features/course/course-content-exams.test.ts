import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const lessonsPage = read('./pages/lessons.svelte');
const examGroup = read('./components/lesson/content-exam-group.svelte');

/**
 * The content page and the sidebar must agree about what a course contains.
 *
 * They did not: the sidebar listed the course's exams and the content page had no
 * reference to an exam at all, so a teacher saw a group in one place and nothing in the
 * other. These checks are on the source because the defect was an absence — a rendering
 * test of the old page passed perfectly while the group it should have shown did not exist.
 */
describe('exams on the course content page', () => {
  it('lists the exams the sidebar lists', () => {
    expect(lessonsPage).toContain('ContentExamGroup');
    expect(lessonsPage).toContain('courseExams.load(courseId)');
  });

  it('hides them from anyone reading the course as a learner', () => {
    // An exam delivers a detached container so a student cannot open the paper from
    // course content without a clock. Listing it here would hand that back.
    expect(lessonsPage).toMatch(/canSeeExams = \$derived\(!\$isCourseLearnerView && courseExams\.available\)/);
    expect(lessonsPage).toMatch(/if \(\$isCourseLearnerView\) return;/);

    for (const block of lessonsPage.split('<ContentExamGroup').slice(0, -1)) {
      expect(block.slice(-200)).toContain('canSeeExams');
    }
  });

  it('keeps them out of the reorder zone', () => {
    // Exams are not course content and never take part in its ordering.
    expect(lessonsPage).toContain('{#if canSeeExams && !reorder}');
    expect(examGroup).not.toContain('dndzone');
  });

  it('reads the store the sidebar reads rather than fetching again', () => {
    expect(examGroup).toContain("from '$features/course/api/exams.svelte'");
    expect(examGroup).not.toContain('classroomhub.exam');
  });
});
