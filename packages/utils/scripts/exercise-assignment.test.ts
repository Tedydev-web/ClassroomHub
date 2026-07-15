import assert from 'node:assert/strict';
import test from 'node:test';

import { ZExerciseAssignmentUpdate } from '../src/validation/exercise/assignment.js';

const memberId = 'd290f1ee-6c54-4b01-90e6-d701748f0851';

test('validates exercise assignment modes', () => {
  assert.deepEqual(ZExerciseAssignmentUpdate.parse({ mode: 'ALL_STUDENTS' }), {
    mode: 'ALL_STUDENTS',
    groupMemberIds: []
  });
  assert.equal(ZExerciseAssignmentUpdate.safeParse({ mode: 'SELECTED_STUDENTS', groupMemberIds: [] }).success, false);
  assert.equal(
    ZExerciseAssignmentUpdate.safeParse({
      mode: 'SELECTED_STUDENTS',
      groupMemberIds: [memberId, memberId]
    }).success,
    false
  );
  assert.equal(
    ZExerciseAssignmentUpdate.safeParse({ mode: 'SELECTED_STUDENTS', groupMemberIds: [memberId] }).success,
    true
  );
});
