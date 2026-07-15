import assert from 'node:assert/strict';
import test from 'node:test';

import { ZNotifyCourseExercisePayload } from '../src/payloads/notifications.js';

const payload = {
  courseId: 'course-a',
  exerciseId: 'exercise-a',
  exerciseTitle: 'Exercise A',
  courseName: 'Course A',
  orgName: 'Org A',
  organizationId: 'org-a',
  fromName: 'Org A',
  quizUrl: 'https://app.example.com/exercise-a'
};

test('requires an exercise id for recipient resolution', () => {
  assert.equal(ZNotifyCourseExercisePayload.safeParse(payload).success, true);

  const payloadWithoutExerciseId = { ...payload, exerciseId: undefined };
  assert.equal(ZNotifyCourseExercisePayload.safeParse(payloadWithoutExerciseId).success, false);
});
