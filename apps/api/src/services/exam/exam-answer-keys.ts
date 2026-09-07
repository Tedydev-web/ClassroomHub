import { getCloudflarePdfBuffer } from '@api/utils/cloudflare';
import { AppError, ErrorCodes } from '@api/utils/errors';
import { getExamById } from '@cio/db/queries/exam/exam';
import { getAssessmentInteractionBlocks, type AssessmentItemDefinition } from '@cio/question-types';

import { applyCorrections, type ExamCorrection } from './exam-grading';
import { buildAnswerMatrix, type MatrixAttempt } from './exam-answer-matrix';
import { buildAnswerDistribution } from './exam-answer-distribution';
import { buildAnswerWorkbookSheets } from './exam-answer-workbook';
import { resolveExportLocale, WORKBOOK_LABELS } from './exam-export-labels';
import { buildXlsx } from './exam-workbook-xlsx';
import type { ExamPaperSnapshot } from './exam-paper-serializer';
import { requireExamsEnabled } from './exam';
import { db } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

/**
 * The answer key of a frozen paper, as the teacher who has to fix one needs to read it.
 *
 * This deliberately reports the paper as grading sees it — the snapshot with every
 * correction already applied — rather than the snapshot alone. A teacher correcting a key
 * for the second time must see the key currently in force, not the one the paper froze
 * with, or the correction they submit would be measured against the wrong starting point.
 *
 * It is not the same thing as `summariseExamPaperService`, which counts questions in the
 * live container. The container can have moved on since the exam opened; only the snapshot
 * says what the candidates actually sat.
 */

/** A, B, C … then plain numbers, which is how the options are labelled to a candidate. */
const OPTION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export type ExamAnswerKeyOption = { id: string; label: string; html: string };

export type ExamAnswerKeyQuestion = {
  questionId: number;
  /** Position in delivery order, one-based, which is the number on the candidate's paper. */
  /**
   * The number the paper prints beside this question, counted across the whole paper.
   *
   * It used to be the item's place in the list, which on a paper of passages is a different
   * number entirely: forty questions across ten passages numbered one to ten here and one to
   * forty everywhere else, so a teacher could not match a row to the question they meant.
   */
  position: number;
  /** The interaction this row is about. An item can hold several; each is one question. */
  interactionId: string;
  points: number;
  promptHtml: string;
  options: ExamAnswerKeyOption[];
  /** The key in force right now: the frozen one, or the last correction to replace it. */
  effectiveKey: string[];
  /**
   * How many options a candidate could pick. On a `single` question the grader compares
   * the key against a response of exactly one option and requires the two to be the same
   * length, so a two-option key marks every candidate wrong. The screen must not offer it.
   */
  cardinality: 'single' | 'multiple';
  /** A key can only be replaced where there is a key to replace. */
  keyFixable: boolean;
  /**
   * How many questions the item holding this one contains.
   *
   * An award is recorded against the item, so on a passage it reaches every question in it.
   * The screen has to be able to say that in numbers rather than leave a teacher to discover
   * it from the results.
   */
  questionsInItem: number;
  /**
   * Whether more than one part of this question is answered by choosing options. A key fix
   * writes the corrected key into every one of them, so where this is true the teacher is
   * offered the award instead — correcting one part would silently rewrite the others.
   */
  hasSeveralChoiceParts: boolean;
  awarded: boolean;
  corrected: boolean;
};

type ChoiceConfig = {
  options?: Array<{ id: string; html?: string }>;
  correctOptionIds?: string[];
  cardinality?: 'single' | 'multiple';
};

/**
 * One row per question, not per item.
 *
 * An item is a container: a passage holding six questions is one row in the paper snapshot
 * and six numbers on the paper the class sat. Listing items meant every passage appeared
 * once, showing the prompt, the options and the key of its *first* part while the other
 * five were not on the screen at all — and the single letter printed as "the answer" was
 * the answer to a question the teacher could not see they were looking at.
 *
 * Numbering counts every interaction, choice or not, because that is how the paper numbers
 * them. A written answer occupies a number even though it has no key to correct, and
 * skipping it here would shift every number after it.
 */
export function buildAnswerKeyRows(
  questions: Array<{ questionId: number; order: number; points: number; definition: unknown }>,
  kindsByQuestion: Map<number, Set<ExamCorrection['kind']>>
): ExamAnswerKeyQuestion[] {
  const rows: ExamAnswerKeyQuestion[] = [];
  let position = 0;

  for (const question of questions.slice().sort((a, b) => a.order - b.order)) {
    const kinds = kindsByQuestion.get(question.questionId);
    const blocks = getAssessmentInteractionBlocks(question.definition as AssessmentItemDefinition);
    const choiceParts = blocks.filter((block) => block.interaction.kind === 'choice').length;

    const context = (
      (question.definition as { blocks?: Array<{ kind: string; content?: { html?: string } }> })?.blocks ?? []
    )
      .filter((block) => block.kind === 'content')
      .map((block) => block.content?.html ?? '')
      .join('');

    for (const block of blocks) {
      position += 1;

      const interaction = block.interaction as { kind?: string; prompt?: { html?: string }; config?: ChoiceConfig };
      const isChoice = interaction.kind === 'choice';
      const config = isChoice ? (interaction.config ?? {}) : {};

      rows.push({
        questionId: question.questionId,
        interactionId: block.id,
        position,
        points: question.points,
        promptHtml: interaction.prompt?.html ?? '',
        options: (config.options ?? []).map((option, index) => ({
          id: option.id,
          label: OPTION_LABELS[index] ?? String(index + 1),
          html: option.html ?? ''
        })),
        effectiveKey: [...(config.correctOptionIds ?? [])],
        cardinality: config.cardinality === 'multiple' ? 'multiple' : 'single',
        keyFixable: isChoice,
        questionsInItem: blocks.length,
        // Still true of the item, and still the reason a key fix is withheld here: the write
        // path replaces the key in every choice part of the item it is given.
        hasSeveralChoiceParts: choiceParts > 1,
        awarded: kinds?.has('award') ?? false,
        corrected: kinds?.has('keyFix') ?? false
      });
    }
  }

  return rows;
}

export async function listExamAnswerKeysService(examId: string) {
  requireExamsEnabled();

  const exam = await getExamById(examId);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const snapshot = exam.paperSnapshot as ExamPaperSnapshot | null;
  if (!snapshot || !snapshot.questions?.length) {
    throw new AppError('This exam has no frozen paper', ErrorCodes.VALIDATION_ERROR, 409);
  }

  const corrections = (exam.corrections as ExamCorrection[]) ?? [];
  const corrected = applyCorrections(snapshot, corrections);

  const kindsByQuestion = new Map<number, Set<ExamCorrection['kind']>>();
  for (const correction of corrections) {
    const kinds = kindsByQuestion.get(correction.questionId) ?? new Set();
    kinds.add(correction.kind);
    kindsByQuestion.set(correction.questionId, kinds);
  }

  return {
    questions: buildAnswerKeyRows(corrected.questions, kindsByQuestion),
    /**
     * The paper itself, corrected, with its keys intact.
     *
     * The screen draws the paper the class read — passage beside its questions — and cannot
     * do that from a list of options. The sitting paper is no use here: it strips
     * `correctOptionIds` on the way out, which is right for a candidate and leaves nothing to
     * mark. This is behind the same guard as the key list, and it is the same secret.
     */
    paper: corrected
  };
}

/**
 * The class's answers as one table, for a teacher going through the paper with them.
 *
 * Built on the same rows the corrections screen reads, so the column headed question seven
 * is the same question seven in both places — two ways of numbering one paper is how a
 * marking sheet comes to be confidently wrong.
 *
 * `attemptIds` narrows it to the candidates the teacher picked; empty means the whole class.
 */
export async function buildExamAnswerMatrixService(examId: string, attemptIds: string[] = []) {
  requireExamsEnabled();

  const { questions } = await listExamAnswerKeysService(examId);

  const rows = await db
    .select({
      attemptId: schema.examAttempt.id,
      displayName: schema.examAttempt.displayName,
      nickname: schema.examAttempt.nickname,
      className: schema.examAttempt.className,
      candidateNumber: schema.examAttempt.candidateNumber,
      score: schema.examAttempt.score,
      total: schema.examAttempt.total,
      startedAt: schema.examAttempt.startedAt,
      submittedAt: schema.examAttempt.submittedAt,
      // Counted in the database, as the results list does: the workbook needs one integer,
      // not the log it comes from.
      leaves: sql<number>`(
        select count(*)::int
        from jsonb_array_elements(${schema.examAttempt.activityLog}) as event
        where event->>'kind' = 'left'
      )`,
      answers: schema.examAttempt.answers
    })
    .from(schema.examAttempt)
    .where(
      and(
        eq(schema.examAttempt.examId, examId),
        sql`${schema.examAttempt.status} <> 'in_progress'`,
        attemptIds.length > 0 ? inArray(schema.examAttempt.id, attemptIds) : undefined
      )
    );

  return buildAnswerMatrix(
    questions,
    rows.map((row) => ({ ...row, answers: (row.answers as MatrixAttempt['answers']) ?? [] }))
  );
}

/**
 * What the class chose, per question, for the screen a teacher reads before going through
 * the paper in the room. Built from the same matrix as the workbook so the two agree.
 */
export async function buildExamAnswerDistributionService(examId: string) {
  requireExamsEnabled();

  return buildAnswerDistribution(await buildExamAnswerMatrixService(examId));
}

/**
 * The workbook itself, named so a folder of them stays sortable.
 *
 * Built on the server because the file is a zip of XML and the browser has no reason to
 * carry a spreadsheet writer for one screen.
 */
export async function buildExamAnswerWorkbookService(
  examId: string,
  attemptIds: string[],
  /**
   * The language of the file, not of the caller.
   *
   * A request says which language to write in; the wording itself lives on the server, so
   * a screen cannot half-translate a workbook by forgetting a label. Anything unrecognised
   * resolves to English rather than to nothing — see `resolveExportLocale`.
   */
  locale: unknown = 'en',
  now = new Date()
) {
  const labels = WORKBOOK_LABELS[resolveExportLocale(locale)];

  const exam = await getExamById(examId);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const matrix = await buildExamAnswerMatrixService(examId, attemptIds);
  const stamp = examWorkbookStamp(now);

  const sheets = buildAnswerWorkbookSheets(matrix, labels, exam.title, stamp.readable);
  const file = await buildXlsx(sheets);

  return { file, fileName: examWorkbookFileName(exam.title, matrix, stamp.compact) };
}

/** The largest sheet document worth rendering, so one request cannot hand Cloudflare a book. */
const MAX_ANSWER_SHEET_HTML_BYTES = 4_000_000;

/**
 * The printed answer sheets as a file, rather than as a browser print dialog.
 *
 * The markup is the sheet page's own, rendered by the dashboard and handed here: that page
 * is the only description of the layout, and generating a second copy of it on this side is
 * how an approved design drifts from the one a teacher signed off. This turns it into a PDF
 * and names it the way the workbook is named, so both land in a folder that stays sortable.
 */
export async function buildExamAnswerSheetPdfService(
  examId: string,
  attemptIds: string[],
  html: string,
  styles: string | undefined,
  now = new Date()
) {
  requireExamsEnabled();

  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new AppError('Answer sheet markup is required', ErrorCodes.VALIDATION_ERROR, 400, 'html');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_ANSWER_SHEET_HTML_BYTES) {
    throw new AppError('Answer sheet markup is too large to render', ErrorCodes.VALIDATION_ERROR, 400, 'html');
  }

  const exam = await getExamById(examId);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const matrix = await buildExamAnswerMatrixService(examId, attemptIds);
  const stamp = examWorkbookStamp(now);

  // The sheet states its own page size and margins, and those were settled by eye against a
  // printed Ministry form. `preferCSSPageSize` is what makes the renderer read them instead
  // of imposing its own.
  const file = await getCloudflarePdfBuffer(html, styles, undefined, {
    preferCSSPageSize: true,
    printBackground: true
  });

  return { file, fileName: examAnswerSheetFileName(exam.title, matrix, stamp.compact) };
}

/** The moment the file was made, in both the shapes it is needed in. */
function examWorkbookStamp(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  }).formatToParts(now);

  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return {
    readable: `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`,
    compact: `${at('year')}${at('month')}${at('day')}-${at('hour')}${at('minute')}`
  };
}

/**
 * A file name that survives a download folder.
 *
 * The paper, then who it is for, then when it was taken — in that order, because a teacher
 * looking for one file is looking for the paper first. The date is written so that sorting
 * by name sorts by time.
 *
 * Diacritics are folded and spaces become hyphens: the same name has to survive a Windows
 * folder, an email attachment and a chat app, and each of those breaks something different.
 */
function examWorkbookFileName(title: string, matrix: { rows: Array<{ displayName: string | null }> }, stamp: string) {
  const only = matrix.rows.length === 1 ? matrix.rows[0]?.displayName : null;
  const parts = [title, only ?? `${matrix.rows.length}-hs`, stamp]
    .map(toFileNamePart)
    .filter((part) => part.length > 0);

  return `${parts.join('_') || 'bai-lam'}.xlsx`;
}

function examAnswerSheetFileName(
  title: string,
  matrix: { rows: Array<{ displayName: string | null }> },
  stamp: string
) {
  const only = matrix.rows.length === 1 ? matrix.rows[0]?.displayName : null;
  const parts = [title, only ?? `${matrix.rows.length}-hs`, stamp]
    .map(toFileNamePart)
    .filter((part) => part.length > 0);

  return `${parts.join('_') || 'phieu-tra-loi'}.pdf`;
}

function toFileNamePart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase()
    .slice(0, 60);
}
