import assert from 'node:assert/strict';
import test from 'node:test';

import { ENABLED_QUESTION_TYPE_REGISTRY, MAX_INTERACTION_MAX_SCORE, QUESTION_TYPE_REGISTRY } from '@cio/question-types';

import {
  ZExerciseCreate,
  ZExerciseQuestionPoints,
  ZExerciseQuestionTypeId,
  ZExerciseUpdate
} from '../src/validation/exercise/exercise';

test('exercise question type validation follows the enabled registry', () => {
  for (const questionType of ENABLED_QUESTION_TYPE_REGISTRY) {
    assert.equal(ZExerciseQuestionTypeId.parse(questionType.id), questionType.id);
  }

  const disabledQuestionTypes = QUESTION_TYPE_REGISTRY.filter((questionType) => questionType.disabled);
  assert.ok(disabledQuestionTypes.length > 0);
  for (const questionType of disabledQuestionTypes) {
    assert.equal(ZExerciseQuestionTypeId.safeParse(questionType.id).success, false);
  }

  assert.equal(ZExerciseQuestionTypeId.safeParse(Number.MAX_SAFE_INTEGER).success, false);
  assert.equal(ZExerciseQuestionTypeId.safeParse(1.5).success, false);
});

test('exercise question points stay integers capped at the canonical interaction maximum', () => {
  assert.equal(ZExerciseQuestionPoints.parse(0), 0);
  assert.equal(ZExerciseQuestionPoints.parse(MAX_INTERACTION_MAX_SCORE), MAX_INTERACTION_MAX_SCORE);
  assert.equal(ZExerciseQuestionPoints.safeParse(MAX_INTERACTION_MAX_SCORE + 1).success, false);
  assert.equal(ZExerciseQuestionPoints.safeParse(2.5).success, false);
  assert.equal(ZExerciseQuestionPoints.safeParse(-1).success, false);

  const createPayload = (points: number) => ({
    title: 'Exercise',
    courseId: 'course-a',
    order: 1,
    questions: [{ question: 'Question', points }]
  });
  assert.equal(ZExerciseCreate.safeParse(createPayload(MAX_INTERACTION_MAX_SCORE)).success, true);
  assert.equal(ZExerciseCreate.safeParse(createPayload(MAX_INTERACTION_MAX_SCORE + 1)).success, false);

  const updatePayload = (points: number) => ({
    questions: [{ id: 1, question: 'Question', points }]
  });
  assert.equal(ZExerciseUpdate.safeParse(updatePayload(MAX_INTERACTION_MAX_SCORE)).success, true);
  assert.equal(ZExerciseUpdate.safeParse(updatePayload(MAX_INTERACTION_MAX_SCORE + 1)).success, false);
});
