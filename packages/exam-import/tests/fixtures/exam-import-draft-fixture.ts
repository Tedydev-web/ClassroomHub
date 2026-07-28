import type { ExamImportDraft } from '../../src/draft/exam-import-draft';

const sourceSpan = {
  start: { blockIndex: 0, runIndex: 0 },
  end: { blockIndex: 0, runIndex: 3 },
  pageStart: null,
  pageEnd: null
} as const;

export function buildValidExamImportDraft(): ExamImportDraft {
  return {
    schemaVersion: 1,
    source: {
      assetId: 'asset-1',
      fileName: 'exam.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extractor: 'docx'
    },
    title: 'Sample exam',
    fieldStates: [
      {
        target: { kind: 'question_field', questionId: 'question-1', field: 'promptHtml' },
        confidence: 'high',
        origin: 'deterministic',
        provenance: [sourceSpan]
      },
      {
        target: { kind: 'question_field', questionId: 'question-1', field: 'answerKey' },
        confidence: 'medium',
        origin: 'deterministic',
        provenance: [sourceSpan]
      }
    ],
    sharedContents: [
      {
        id: 'passage-1',
        kind: 'passage',
        html: '<p>Read the passage.</p>',
        provenance: [sourceSpan]
      }
    ],
    sections: [
      {
        id: 'section-1',
        title: 'Part I',
        order: 0,
        questions: [
          {
            id: 'question-1',
            kind: 'choice',
            order: 0,
            sourceNumber: '1',
            promptHtml: '<p>Choose the correct answer.</p>',
            points: 0.25,
            cognitiveLevel: null,
            passageId: 'passage-1',
            cardinality: 'single',
            options: [
              { id: 'option-a', sourceLabel: 'A', html: '<p>First</p>', order: 0 },
              { id: 'option-b', sourceLabel: 'B', html: '<p>Second</p>', order: 1 }
            ],
            answerCandidates: [
              {
                id: 'candidate-1',
                kind: 'choice',
                correctOptionIds: ['option-b'],
                source: 'explicit_line',
                provenance: [sourceSpan]
              }
            ],
            answerKey: {
              kind: 'choice',
              correctOptionIds: ['option-b'],
              agreement: 'single_source',
              selectedCandidateIds: ['candidate-1'],
              conflictingCandidateIds: []
            },
            confidence: 'medium',
            review: 'clean',
            provenance: [sourceSpan]
          }
        ]
      }
    ],
    diagnostics: []
  };
}

export { sourceSpan };
