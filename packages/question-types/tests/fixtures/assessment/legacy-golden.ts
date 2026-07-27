import type { ExerciseQuestionModel } from '../../../src';
import type { AssessmentItemDefinition } from '../../../src/assessment';

/**
 * Golden legacy-adapter fixtures: one entry per enabled question type.
 * `expected` is the exact canonical definition the adapter must produce.
 * These pin adapter determinism; any change here is a compatibility change.
 */
export interface LegacyGoldenCase {
  name: string;
  question: ExerciseQuestionModel;
  expected: AssessmentItemDefinition;
}

export const LEGACY_GOLDEN_CASES: LegacyGoldenCase[] = [
  {
    name: 'RADIO maps to single choice with option ids and correct set',
    question: {
      id: 1,
      title: 'Pick one',
      questionType: 'RADIO',
      points: 10,
      options: [
        { id: 11, label: 'A', isCorrect: false },
        { id: 12, label: 'B', isCorrect: true }
      ],
      settings: {}
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { format: 'html', html: 'Pick one' },
            required: true,
            maxScore: 10,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: '11', html: 'A' },
                { id: '12', html: 'B' }
              ],
              correctOptionIds: ['12']
            }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'CHECKBOX maps to multiple choice, keeps fractional points and optional flag',
    question: {
      id: 2,
      title: 'Pick many',
      questionType: 'CHECKBOX',
      points: 7.5,
      options: [
        { id: 21, label: 'A', isCorrect: true },
        { id: 22, label: 'B', isCorrect: false },
        { id: 23, label: 'C', isCorrect: true }
      ],
      settings: { required: false }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { format: 'html', html: 'Pick many' },
            required: false,
            maxScore: 7.5,
            config: {
              cardinality: 'multiple',
              presentation: 'list',
              options: [
                { id: '21', html: 'A' },
                { id: '22', html: 'B' },
                { id: '23', html: 'C' }
              ],
              correctOptionIds: ['21', '23'],
              scoreWeights: { '21': 50, '22': -100, '23': 50 }
            }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'TEXTAREA maps to rich text with character limits',
    question: {
      id: 3,
      title: 'Explain',
      questionType: 'TEXTAREA',
      points: 0,
      options: [],
      settings: { minCharacters: 10, maxCharacters: 200 }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'text',
            prompt: { format: 'html', html: 'Explain' },
            required: true,
            maxScore: 0,
            config: { format: 'rich', minCharacters: 10, maxCharacters: 200 }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'TRUE_FALSE maps to true_false choice with correct value from options',
    question: {
      id: 4,
      title: 'The sky is green',
      questionType: 'TRUE_FALSE',
      points: 2,
      options: [
        { label: 'True', isCorrect: false },
        { label: 'False', isCorrect: true }
      ],
      settings: {}
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { format: 'html', html: 'The sky is green' },
            required: true,
            maxScore: 2,
            config: {
              cardinality: 'single',
              presentation: 'true_false',
              options: [
                { id: 'true', html: 'True' },
                { id: 'false', html: 'False' }
              ],
              correctOptionIds: ['false']
            }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'SHORT_ANSWER maps to plain text with instructions',
    question: {
      id: 5,
      title: 'Capital of France?',
      questionType: 'SHORT_ANSWER',
      points: 1,
      options: [],
      settings: { instructions: 'One word' }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'text',
            prompt: { format: 'html', html: 'Capital of France?' },
            required: true,
            maxScore: 1,
            config: { format: 'plain', instructions: 'One word' }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'NUMERIC maps correct value and tolerance',
    question: {
      id: 6,
      title: 'Answer to everything',
      questionType: 'NUMERIC',
      points: 3,
      options: [],
      settings: { correctValue: 42, tolerance: 0.5 }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'numeric',
            prompt: { format: 'html', html: 'Answer to everything' },
            required: true,
            maxScore: 3,
            config: { correctValue: 42, tolerance: 0.5 }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'FILL_BLANK parses comma separated accepted answers exactly like the legacy codec',
    question: {
      id: 7,
      title: 'Fill in',
      questionType: 'FILL_BLANK',
      points: 4,
      options: [],
      settings: { acceptedAnswers: ' Paris , london ,, Berlin ' }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'fill_blank',
            prompt: { format: 'html', html: 'Fill in' },
            required: true,
            maxScore: 4,
            config: { acceptedAnswers: ['Paris', 'london', 'Berlin'] }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'FILE_UPLOAD normalizes accepted type aliases and keeps max size',
    question: {
      id: 8,
      title: 'Upload your work',
      questionType: 'FILE_UPLOAD',
      points: 5,
      options: [],
      settings: { acceptedTypes: ['pdf', 'image/png'], maxSizeMb: 5 }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'file_upload',
            prompt: { format: 'html', html: 'Upload your work' },
            required: true,
            maxScore: 5,
            config: { acceptedTypes: ['application/pdf', 'image/png'], maxSizeMb: 5 }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'ORDERING maps options to ids and correct order',
    question: {
      id: 9,
      title: 'Order the steps',
      questionType: 'ORDERING',
      points: 6,
      options: [
        { id: 31, label: 'One' },
        { id: 32, label: 'Two' }
      ],
      settings: {}
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'ordering',
            prompt: { format: 'html', html: 'Order the steps' },
            required: true,
            maxScore: 6,
            config: {
              options: [
                { id: '31', html: 'One' },
                { id: '32', html: 'Two' }
              ],
              correctOrder: ['31', '32']
            }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'LINK maps to link with instructions and manual grading',
    question: {
      id: 10,
      title: 'Share your links',
      questionType: 'LINK',
      points: 2,
      options: [],
      settings: { instructions: 'Add portfolio links' }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'link',
            prompt: { format: 'html', html: 'Share your links' },
            required: true,
            maxScore: 2,
            config: { instructions: 'Add portfolio links' }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'WORD_BANK maps template, correct answers, and distractors',
    question: {
      id: 11,
      title: 'Complete the sentence',
      questionType: 'WORD_BANK',
      points: 4,
      options: [],
      settings: {
        template: 'The ___ sat on the ___',
        correctAnswers: ['cat', 'mat'],
        distractors: ['dog']
      }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'word_bank',
            prompt: { format: 'html', html: 'Complete the sentence' },
            required: true,
            maxScore: 4,
            config: {
              template: 'The ___ sat on the ___',
              correctAnswers: ['cat', 'mat'],
              distractors: ['dog']
            }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'STAR maps max stars and correct value',
    question: {
      id: 12,
      title: 'Rate this course',
      questionType: 'STAR',
      points: 1,
      options: [],
      settings: { maxStars: 7, correctValue: 6 }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'star_rating',
            prompt: { format: 'html', html: 'Rate this course' },
            required: true,
            maxScore: 1,
            config: { maxStars: 7, correctValue: 6 }
          }
        }
      ],
      feedback: []
    }
  },
  {
    name: 'VIDEO_RECORDING maps max duration inside the platform cap',
    question: {
      id: 13,
      title: 'Record yourself',
      questionType: 'VIDEO_RECORDING',
      points: 8,
      options: [],
      settings: { maxDurationSeconds: 90 }
    },
    expected: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'interaction-1',
          kind: 'interaction',
          interaction: {
            kind: 'video_recording',
            prompt: { format: 'html', html: 'Record yourself' },
            required: true,
            maxScore: 8,
            config: { maxDurationSeconds: 90 }
          }
        }
      ],
      feedback: []
    }
  }
];
