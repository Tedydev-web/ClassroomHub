import { describe, expect, it } from 'vitest';

import { createAssessmentRichTextAnswer, createAssessmentRichTextQuestion } from './assessment-rich-text-adapter';

describe('canonical assessment rich-text adapter', () => {
  it('preserves rich HTML and maps assessment constraints to the shared textarea renderer contract', () => {
    const question = createAssessmentRichTextQuestion('text-1', {
      kind: 'text',
      prompt: { format: 'html', html: '<p>Explain your reasoning.</p>' },
      required: true,
      maxScore: 3.5,
      config: { format: 'rich', minCharacters: 20, maxCharacters: 500 }
    });
    const answer = createAssessmentRichTextAnswer('<p><strong>Structured</strong> response</p>');

    expect(question).toEqual({
      id: 'text-1',
      title: '',
      questionType: 'TEXTAREA',
      points: 3.5,
      required: true,
      settings: { minCharacters: 20, maxCharacters: 500 }
    });
    expect(answer).toEqual({
      type: 'TEXTAREA',
      text: '<p><strong>Structured</strong> response</p>'
    });
  });
});
