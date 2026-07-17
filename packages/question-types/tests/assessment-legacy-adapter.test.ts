import { describe, expect, it } from 'vitest';
import {
  canonicalizeAssessmentItemDefinition,
  deriveItemCapabilities,
  legacyQuestionToAssessmentItem,
  parseAssessmentItemDefinition
} from '../src/assessment';
import {
  ENABLED_QUESTION_TYPE_REGISTRY,
  QUESTION_TYPE_BY_KEY,
  QUESTION_TYPE_KEY,
  type ExerciseQuestionModel
} from '../src';
import { LEGACY_GOLDEN_CASES } from './fixtures/assessment/legacy-golden';

function buildQuestion(overrides: Partial<ExerciseQuestionModel> = {}): ExerciseQuestionModel {
  return {
    id: 1,
    title: 'Question',
    questionType: QUESTION_TYPE_KEY.RADIO,
    points: 10,
    options: [],
    settings: {},
    ...overrides
  };
}

function adapt(overrides: Partial<ExerciseQuestionModel> = {}) {
  const result = legacyQuestionToAssessmentItem(buildQuestion(overrides));
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('expected adapter success');

  return result.data;
}

function singleInteraction(definition: ReturnType<typeof adapt>) {
  const block = definition.blocks[0];
  if (block.kind !== 'interaction') throw new Error('expected interaction block');

  return block.interaction;
}

describe('legacyQuestionToAssessmentItem — golden fixtures', () => {
  it('covers exactly the enabled question type registry', () => {
    const fixtureTypeKeys = [...new Set(LEGACY_GOLDEN_CASES.map((goldenCase) => goldenCase.question.questionType))];
    const enabledTypeKeys = ENABLED_QUESTION_TYPE_REGISTRY.map((type) => type.key);

    expect(fixtureTypeKeys.sort()).toEqual(enabledTypeKeys.sort());
  });

  for (const goldenCase of LEGACY_GOLDEN_CASES) {
    it(goldenCase.name, () => {
      const result = legacyQuestionToAssessmentItem(goldenCase.question);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data).toEqual(goldenCase.expected);
      expect(parseAssessmentItemDefinition(result.data).success).toBe(true);
    });
  }

  it('is deterministic: repeated adaptation yields identical canonical serialization', () => {
    for (const goldenCase of LEGACY_GOLDEN_CASES) {
      const first = legacyQuestionToAssessmentItem(goldenCase.question);
      const second = legacyQuestionToAssessmentItem(goldenCase.question);
      expect(first.success && second.success).toBe(true);
      if (!first.success || !second.success) return;

      expect(canonicalizeAssessmentItemDefinition(first.data)).toBe(canonicalizeAssessmentItemDefinition(second.data));
    }
  });

  it('derived capabilities match the static registry metadata for every enabled type', () => {
    for (const goldenCase of LEGACY_GOLDEN_CASES) {
      const metadata = QUESTION_TYPE_BY_KEY[goldenCase.question.questionType];
      const capabilities = deriveItemCapabilities(goldenCase.expected);

      expect(capabilities.autoGradable, goldenCase.name).toBe(metadata.autoGradable);
      expect(capabilities.supportsPartialCredit, goldenCase.name).toBe(metadata.supportsPartialCredit);
      expect(capabilities.manualGradingRequired, goldenCase.name).toBe(metadata.manualGradingRequired);
    }
  });
});

describe('legacyQuestionToAssessmentItem — edge behavior', () => {
  it('clamps star settings exactly like the legacy canonicalizers', () => {
    const clamped = singleInteraction(
      adapt({ questionType: QUESTION_TYPE_KEY.STAR, settings: { maxStars: 22, correctValue: 6 } })
    );
    expect(clamped.kind).toBe('star_rating');
    if (clamped.kind !== 'star_rating') return;

    expect(clamped.config.maxStars).toBe(10);
    expect(clamped.config.correctValue).toBe(6);

    const invalidCorrect = singleInteraction(
      adapt({ questionType: QUESTION_TYPE_KEY.STAR, settings: { maxStars: 5, correctValue: 9 } })
    );
    if (invalidCorrect.kind !== 'star_rating') return;
    expect(invalidCorrect.config.correctValue).toBeNull();
  });

  it('clamps and defaults video recording duration', () => {
    const clamped = singleInteraction(
      adapt({ questionType: QUESTION_TYPE_KEY.VIDEO_RECORDING, settings: { maxDurationSeconds: 999 } })
    );
    const defaulted = singleInteraction(adapt({ questionType: QUESTION_TYPE_KEY.VIDEO_RECORDING, settings: {} }));

    if (clamped.kind !== 'video_recording' || defaulted.kind !== 'video_recording') {
      throw new Error('expected video_recording');
    }
    expect(clamped.config.maxDurationSeconds).toBe(120);
    expect(defaulted.config.maxDurationSeconds).toBe(60);
  });

  it('maps an invalid numeric answer key to null (always-zero semantics preserved)', () => {
    const missing = singleInteraction(adapt({ questionType: QUESTION_TYPE_KEY.NUMERIC, settings: {} }));
    const badTolerance = singleInteraction(
      adapt({ questionType: QUESTION_TYPE_KEY.NUMERIC, settings: { correctValue: 5, tolerance: -1 } })
    );

    if (missing.kind !== 'numeric' || badTolerance.kind !== 'numeric') throw new Error('expected numeric');
    expect(missing.config.correctValue).toBeNull();
    expect(missing.config.tolerance).toBe(0);
    expect(badTolerance.config.correctValue).toBeNull();
  });

  it('prefers settings.correctValue over options for TRUE_FALSE', () => {
    const interaction = singleInteraction(
      adapt({
        questionType: QUESTION_TYPE_KEY.TRUE_FALSE,
        options: [
          { label: 'True', isCorrect: true },
          { label: 'False', isCorrect: false }
        ],
        settings: { correctValue: false }
      })
    );

    if (interaction.kind !== 'choice') throw new Error('expected choice');
    expect(interaction.config.correctOptionIds).toEqual(['false']);
  });

  it('builds ordering from settings.items when no options exist', () => {
    const interaction = singleInteraction(
      adapt({ questionType: QUESTION_TYPE_KEY.ORDERING, options: [], settings: { items: [' First ', 'Second'] } })
    );

    if (interaction.kind !== 'ordering') throw new Error('expected ordering');
    expect(interaction.config.options).toEqual([
      { id: 'First', html: 'First' },
      { id: 'Second', html: 'Second' }
    ]);
    expect(interaction.config.correctOrder).toEqual(['First', 'Second']);
  });

  it('reorders ordering correctOrder from settings.items labels when options exist', () => {
    const interaction = singleInteraction(
      adapt({
        questionType: QUESTION_TYPE_KEY.ORDERING,
        options: [
          { id: 31, label: 'One' },
          { id: 32, label: 'Two' }
        ],
        settings: { items: ['Two', 'One'] }
      })
    );

    if (interaction.kind !== 'ordering') throw new Error('expected ordering');
    expect(interaction.config.options.map((option) => option.id)).toEqual(['31', '32']);
    expect(interaction.config.correctOrder).toEqual(['32', '31']);
  });

  it('normalizes points: null and negative become 0, fractions keep two decimals', () => {
    expect(singleInteraction(adapt({ points: undefined })).maxScore).toBe(0);
    expect(singleInteraction(adapt({ points: -5 })).maxScore).toBe(0);
    expect(singleInteraction(adapt({ points: 7.25 })).maxScore).toBe(7.25);
    expect(singleInteraction(adapt({ points: 7.333 })).maxScore).toBe(7.33);
  });

  it('maps settings.required === false to an optional interaction', () => {
    expect(singleInteraction(adapt({ settings: { required: false } })).required).toBe(false);
    expect(singleInteraction(adapt({ settings: {} })).required).toBe(true);
  });

  it('rejects disabled and internal question types with UNSUPPORTED_LEGACY_TYPE', () => {
    for (const questionType of [
      QUESTION_TYPE_KEY.MATCHING,
      QUESTION_TYPE_KEY.HOTSPOT,
      QUESTION_TYPE_KEY.ASSESSMENT_ITEM
    ]) {
      const result = legacyQuestionToAssessmentItem(buildQuestion({ questionType }));
      expect(result.success).toBe(false);
      if (result.success) continue;

      expect(result.issues[0]?.code).toBe('UNSUPPORTED_LEGACY_TYPE');
    }
  });
});
