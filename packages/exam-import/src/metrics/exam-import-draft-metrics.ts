import type { ExamImportDraft, ExamImportQuestion } from '../draft/exam-import-draft';
import type { ExtractedExam, ReferenceQuestion } from './reference-exam';

function decodeHtmlEntity(entity: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };
  if (entity in named) return named[entity]!;
  const numeric = entity.startsWith('#x')
    ? Number.parseInt(entity.slice(2), 16)
    : entity.startsWith('#')
      ? Number.parseInt(entity.slice(1), 10)
      : Number.NaN;

  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
    ? String.fromCodePoint(numeric)
    : `&${entity};`;
}

function authoredHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<\/(?:div|li|p|tr)>/giu, ' ')
    .replace(/<[^>]*>/gu, '')
    .replace(/&([A-Za-z]+|#[0-9]+|#x[0-9A-Fa-f]+);/gu, (_, entity: string) => decodeHtmlEntity(entity))
    .replace(/\s+/gu, ' ')
    .trim();
}

function answerLabels(question: ExamImportQuestion): string[] | null {
  switch (question.kind) {
    case 'choice':
      return (
        question.answerKey?.correctOptionIds.map(
          (optionId) => question.options.find((option) => option.id === optionId)?.sourceLabel ?? optionId
        ) ?? null
      );
    case 'true_false_group':
      return (
        question.answerKey?.answers
          .filter((answer) => answer.correctValue)
          .map(
            (answer) =>
              question.statements.find((statement) => statement.id === answer.statementId)?.sourceLabel ??
              answer.statementId
          ) ?? null
      );
    case 'short_answer':
      return question.answerKey ? [...question.answerKey.acceptedAnswers] : null;
    case 'numeric':
      return question.answerKey ? [String(question.answerKey.value)] : null;
    case 'essay':
    case 'unresolved':
      return null;
  }

  question satisfies never;
  return null;
}

function extractedQuestion(question: ExamImportQuestion): ReferenceQuestion {
  const common = {
    number: question.sourceNumber ?? String(question.order + 1),
    groupId: question.passageId,
    answerKey: answerLabels(question),
    prompt: authoredHtmlToText(question.promptHtml),
    reviewRequired: question.review !== 'clean'
  };

  switch (question.kind) {
    case 'choice':
      return {
        ...common,
        kind: 'choice',
        optionCount: question.options.length,
        options: question.options.map((option) => authoredHtmlToText(option.html))
      };
    case 'true_false_group':
      return {
        ...common,
        kind: 'true_false_group',
        optionCount: question.statements.length,
        options: question.statements.map((statement) => authoredHtmlToText(statement.html))
      };
    case 'short_answer':
      return { ...common, kind: 'short_answer', optionCount: 0, options: [] };
    case 'numeric':
      return { ...common, kind: 'numeric', optionCount: 0, options: [] };
    case 'essay':
      return { ...common, kind: 'essay', optionCount: 0, options: [] };
    case 'unresolved':
      return { ...common, kind: null, optionCount: null, options: null };
  }

  question satisfies never;
  return { ...common, kind: null, optionCount: null, options: null };
}

export function examImportDraftToExtractedExam(draft: ExamImportDraft): ExtractedExam {
  return {
    questions: draft.sections.flatMap((section) => section.questions.map((question) => extractedQuestion(question)))
  };
}
