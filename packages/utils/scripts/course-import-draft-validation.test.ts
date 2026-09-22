import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_INTERACTION_MAX_SCORE } from '@cio/question-types';

import {
  ZCourseImportDraftExerciseQuestion,
  ZCourseImportDraftPayload
} from '../src/validation/course-import/course-import';

test('course import draft question points share the authored integer cap', () => {
  const question = (points: number) => ({ question: 'Draft question', points });

  assert.equal(ZCourseImportDraftExerciseQuestion.safeParse(question(0)).success, true);
  assert.equal(ZCourseImportDraftExerciseQuestion.safeParse(question(MAX_INTERACTION_MAX_SCORE)).success, true);
  assert.equal(ZCourseImportDraftExerciseQuestion.safeParse(question(MAX_INTERACTION_MAX_SCORE + 1)).success, false);
  assert.equal(ZCourseImportDraftExerciseQuestion.safeParse(question(2.5)).success, false);
  assert.equal(ZCourseImportDraftExerciseQuestion.safeParse(question(-1)).success, false);

  // Points stay optional for drafts that omit them.
  assert.equal(ZCourseImportDraftExerciseQuestion.safeParse({ question: 'No points' }).success, true);
});

test('course import draft payload enforces the question points cap end to end', () => {
  const draftPayload = (points: number) => ({
    course: { title: 'Imported course', description: 'Imported description', type: 'LIVE_CLASS' },
    sections: [{ externalId: 'section-1', title: 'Section', order: 1 }],
    lessons: [{ externalId: 'lesson-1', sectionExternalId: 'section-1', title: 'Lesson', order: 1 }],
    lessonLanguages: [{ lessonExternalId: 'lesson-1', locale: 'en', content: '<h3>Body</h3>' }],
    exercises: [
      {
        externalId: 'exercise-1',
        lessonExternalId: 'lesson-1',
        title: 'Exercise',
        order: 1,
        questions: [{ question: 'Question', points }]
      }
    ]
  });

  assert.equal(ZCourseImportDraftPayload.safeParse(draftPayload(MAX_INTERACTION_MAX_SCORE)).success, true);
  assert.equal(ZCourseImportDraftPayload.safeParse(draftPayload(MAX_INTERACTION_MAX_SCORE + 1)).success, false);
  assert.equal(ZCourseImportDraftPayload.safeParse(draftPayload(0.5)).success, false);
});
