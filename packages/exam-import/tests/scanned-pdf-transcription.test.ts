import { describe, expect, it } from 'vitest';

import {
  markExamImportDraftAsAiDerived,
  scannedPdfTranscriptionsToSourceRuns
} from '../src/pdf/scanned-pdf-transcription';
import type { ExamImportDraft } from '../src/draft/exam-import-draft';

const provenance = [
  {
    start: { blockIndex: 0, runIndex: 0 },
    end: { blockIndex: 2, runIndex: 0 },
    pageStart: null,
    pageEnd: null
  }
];

describe('scanned PDF transcription normalization', () => {
  it('converts ordered page lines into one contiguous source-run stream', () => {
    const runs = scannedPdfTranscriptionsToSourceRuns([
      {
        pageIndex: 0,
        lines: ['Question 1. Choose.', 'A. First']
      },
      {
        pageIndex: 1,
        lines: ['B. Second']
      }
    ]);

    expect(runs.map((run) => run.text)).toEqual(['Question 1. Choose.', 'A. First', 'B. Second']);
    expect(runs.map((run) => run.location)).toEqual([
      { blockIndex: 0, runIndex: 0 },
      { blockIndex: 1, runIndex: 0 },
      { blockIndex: 2, runIndex: 0 }
    ]);
    expect(runs.every((run) => run.formatting.bold === false && run.image === null)).toBe(true);
  });

  it('rejects missing, duplicated, or reordered pages', () => {
    expect(() =>
      scannedPdfTranscriptionsToSourceRuns([
        { pageIndex: 0, lines: ['Page one'] },
        { pageIndex: 2, lines: ['Page three'] }
      ])
    ).toThrow();
    expect(() =>
      scannedPdfTranscriptionsToSourceRuns([
        { pageIndex: 0, lines: ['Page one'] },
        { pageIndex: 0, lines: ['Page one again'] }
      ])
    ).toThrow();
    expect(() => scannedPdfTranscriptionsToSourceRuns([{ pageIndex: 0, lines: ['   '] }])).toThrow();
  });

  it('downgrades every machine-derived field and publishable question to mandatory review', () => {
    const draft: ExamImportDraft = {
      schemaVersion: 1,
      source: {
        assetId: 'asset-1',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        extractor: 'pdf'
      },
      title: 'Scanned exam',
      fieldStates: [
        {
          target: { kind: 'draft_field', field: 'title' },
          confidence: 'high',
          origin: 'deterministic',
          provenance
        },
        {
          target: { kind: 'question_field', questionId: 'question-1', field: 'promptHtml' },
          confidence: 'teacher_confirmed',
          origin: 'teacher',
          provenance: []
        }
      ],
      sharedContents: [],
      sections: [
        {
          id: 'section-1',
          title: 'Questions',
          order: 0,
          questions: [
            {
              id: 'question-1',
              kind: 'choice',
              order: 0,
              sourceNumber: '1',
              promptHtml: '<p>Choose.</p>',
              points: 1,
              cognitiveLevel: null,
              passageId: null,
              cardinality: 'single',
              options: [
                { id: 'option-a', sourceLabel: 'A', html: '<p>First</p>', order: 0 },
                { id: 'option-b', sourceLabel: 'B', html: '<p>Second</p>', order: 1 }
              ],
              answerCandidates: [
                {
                  id: 'candidate-1',
                  kind: 'choice',
                  correctOptionIds: ['option-a'],
                  source: 'explicit_line',
                  provenance
                }
              ],
              answerKey: {
                kind: 'choice',
                correctOptionIds: ['option-a'],
                agreement: 'single_source',
                selectedCandidateIds: ['candidate-1'],
                conflictingCandidateIds: []
              },
              confidence: 'high',
              review: 'clean',
              provenance
            }
          ]
        }
      ],
      diagnostics: []
    };

    const marked = markExamImportDraftAsAiDerived(draft);

    expect(marked.fieldStates).toEqual([
      expect.objectContaining({ confidence: 'low', origin: 'ai' }),
      expect.objectContaining({ confidence: 'teacher_confirmed', origin: 'teacher' })
    ]);
    expect(marked.sections[0]?.questions[0]).toMatchObject({
      confidence: 'low',
      review: 'needs_attention',
      answerCandidates: [expect.objectContaining({ source: 'ai' })]
    });
  });

  it('keeps an AI-transcribed question unresolved until it has a required answer key', () => {
    const draft: ExamImportDraft = {
      schemaVersion: 1,
      source: {
        assetId: 'asset-1',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        extractor: 'pdf'
      },
      title: 'Scanned exam',
      fieldStates: [],
      sharedContents: [],
      sections: [
        {
          id: 'section-1',
          title: 'Questions',
          order: 0,
          questions: [
            {
              id: 'question-1',
              kind: 'choice',
              order: 0,
              sourceNumber: '1',
              promptHtml: '<p>Choose.</p>',
              points: 1,
              cognitiveLevel: null,
              passageId: null,
              cardinality: 'single',
              options: [
                { id: 'option-a', sourceLabel: 'A', html: '<p>First</p>', order: 0 },
                { id: 'option-b', sourceLabel: 'B', html: '<p>Second</p>', order: 1 }
              ],
              answerCandidates: [],
              answerKey: null,
              confidence: 'medium',
              review: 'unresolved',
              provenance
            }
          ]
        }
      ],
      diagnostics: []
    };

    expect(markExamImportDraftAsAiDerived(draft).sections[0]?.questions[0]).toMatchObject({
      confidence: 'low',
      review: 'unresolved'
    });
  });
});
