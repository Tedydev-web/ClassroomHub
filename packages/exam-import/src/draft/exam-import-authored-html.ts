import type { ExamImportDraft, ExamImportQuestion } from './exam-import-draft';

function mapQuestionHtml(question: ExamImportQuestion, transform: (html: string) => string): ExamImportQuestion {
  const promptHtml = transform(question.promptHtml);

  switch (question.kind) {
    case 'choice':
      return {
        ...question,
        promptHtml,
        options: question.options.map((option) => ({ ...option, html: transform(option.html) }))
      };
    case 'true_false_group':
      return {
        ...question,
        promptHtml,
        statements: question.statements.map((statement) => ({
          ...statement,
          html: transform(statement.html)
        }))
      };
    case 'unresolved':
      return { ...question, promptHtml, rawHtml: transform(question.rawHtml) };
    case 'short_answer':
    case 'numeric':
    case 'essay':
      return { ...question, promptHtml };
  }

  question satisfies never;
  throw new Error('Unsupported exam import question kind');
}

/** Applies a server-provided sanitizer to every authored HTML field and no answer-key data. */
export function mapExamImportDraftHtml(draft: ExamImportDraft, transform: (html: string) => string): ExamImportDraft {
  return {
    ...draft,
    sharedContents: draft.sharedContents.map((content) => ({
      ...content,
      html: transform(content.html)
    })),
    sections: draft.sections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => mapQuestionHtml(question, transform))
    }))
  };
}
