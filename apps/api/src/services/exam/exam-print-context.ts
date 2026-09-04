import { db } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { eq } from 'drizzle-orm';

import { AppError, ErrorCodes } from '@api/utils/errors';

import { resolveExportLocale, SHEET_LABELS } from './exam-export-labels';

/**
 * Who a printed sheet belongs to, and what it is a sheet of.
 *
 * A page that leaves the system stops being able to answer for itself: it is carried to a
 * staff room, photocopied, filed, and read months later beside forty others. The masthead
 * and the foot are what let it still say which school issued it, which course and paper it
 * records, and that it was correct at the moment it was printed.
 *
 * Read in one query beside the answers rather than assembled on the screen, because the
 * screen only knows the ids in its own URL.
 */
export async function getExamPrintContextService(examId: string, locale: unknown = 'en') {
  const [row] = await db
    .select({
      examTitle: schema.exam.title,
      courseId: schema.exam.courseId,
      courseTitle: schema.course.title,
      organizationName: schema.organization.name,
      organizationLogo: schema.organization.avatarUrl
    })
    .from(schema.exam)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.exam.organizationId))
    // A paper can exist before it is filed under a course, and a sheet for one still prints.
    .leftJoin(schema.course, eq(schema.course.id, schema.exam.courseId))
    .where(eq(schema.exam.id, examId))
    .limit(1);

  if (!row) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  // The sheet's wording travels with its masthead, from the same table the workbook reads,
  // so the two files a teacher exports on the same afternoon cannot disagree about what a
  // column is called.
  return { ...row, labels: SHEET_LABELS[resolveExportLocale(locale)] };
}
