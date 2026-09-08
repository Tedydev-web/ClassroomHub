import assert from 'node:assert/strict';
import test from 'node:test';

import { ROLE } from '../src/constants/roles';
import { shouldScopeExercisesToAssignments } from '../src/functions/course-enrollment';

/**
 * Regression: an organisation owner opening a course they are not enrolled in.
 *
 * The course content query narrowed exercises to what the viewer was assigned, and read a
 * missing membership as "assigned nothing". Every exercise vanished from the course while
 * the lessons stayed — so the course did not look broken, it looked empty, and a paper
 * that had just been imported had no entry point anywhere in the interface.
 */
test('a viewer with no membership is not scoped to assignments', () => {
  assert.equal(shouldScopeExercisesToAssignments(undefined, ROLE.STUDENT), false);
  assert.equal(shouldScopeExercisesToAssignments(null, ROLE.STUDENT), false);
});

test('a student is scoped to their assignments', () => {
  assert.equal(shouldScopeExercisesToAssignments({ roleId: ROLE.STUDENT }, ROLE.STUDENT), true);
});

test('a member who is not a student sees the whole course', () => {
  for (const roleId of Object.values(ROLE)) {
    if (roleId === ROLE.STUDENT) continue;
    assert.equal(shouldScopeExercisesToAssignments({ roleId }, ROLE.STUDENT), false, `role ${roleId} was scoped`);
  }
});
