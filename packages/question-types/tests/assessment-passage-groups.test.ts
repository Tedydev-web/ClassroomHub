import { describe, expect, it } from 'vitest';

import { groupAssessmentBlocksByPassage, type AssessmentBlock } from '../src/assessment';

const passage = (id: string): AssessmentBlock => ({
  id,
  kind: 'content',
  content: { format: 'html', html: `<p>${id}</p>` }
});

const interaction = (id: string): AssessmentBlock => ({
  id,
  kind: 'interaction',
  interaction: {
    kind: 'text',
    prompt: { format: 'html', html: `<p>${id}</p>` },
    required: true,
    maxScore: 1,
    config: { format: 'plain' }
  }
});

describe('groupAssessmentBlocksByPassage', () => {
  it('groups each passage with the interactions that follow it', () => {
    const blocks = [
      passage('passage-1'),
      interaction('question-1'),
      interaction('question-2'),
      passage('passage-2'),
      interaction('question-3')
    ];

    const groups = groupAssessmentBlocksByPassage(blocks);

    expect(groups.map((group) => group.id)).toEqual(['passage-1', 'passage-2']);
    expect(groups[0]?.passage?.id).toBe('passage-1');
    expect(groups[0]?.interactions.map((block) => block.id)).toEqual(['question-1', 'question-2']);
    expect(groups[1]?.passage?.id).toBe('passage-2');
    expect(groups[1]?.interactions.map((block) => block.id)).toEqual(['question-3']);
  });

  it('keeps leading interactions in an unassigned group', () => {
    const groups = groupAssessmentBlocksByPassage([
      interaction('question-1'),
      interaction('question-2'),
      passage('passage-1'),
      interaction('question-3')
    ]);

    expect(groups[0]).toMatchObject({
      id: 'question-1',
      passage: null
    });
    expect(groups[0]?.interactions.map((block) => block.id)).toEqual(['question-1', 'question-2']);
    expect(groups[1]?.passage?.id).toBe('passage-1');
  });

  it('retains empty passage groups without mutating the source blocks', () => {
    const blocks = [passage('passage-1'), passage('passage-2'), interaction('question-1')];
    const snapshot = structuredClone(blocks);

    const groups = groupAssessmentBlocksByPassage(blocks);

    expect(groups[0]?.interactions).toEqual([]);
    expect(groups[1]?.interactions.map((block) => block.id)).toEqual(['question-1']);
    expect(blocks).toEqual(snapshot);
  });
});
