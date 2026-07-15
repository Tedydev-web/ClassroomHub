import assert from 'node:assert/strict';
import test from 'node:test';

import { ROLE } from '@cio/utils/constants';
import { PgDialect } from 'drizzle-orm/pg-core';

import { getExerciseVisibilityCondition } from '../src/queries/exercise/assignment';

const dialect = new PgDialect();
const groupMemberId = 'd290f1ee-6c54-4b01-90e6-d701748f0851';

test('non-student exercise visibility is unrestricted', () => {
  const condition = getExerciseVisibilityCondition(groupMemberId, ROLE.ADMIN);
  const query = dialect.sqlToQuery(condition);

  assert.equal(query.sql, 'true');
  assert.deepEqual(query.params, []);
});

test('student exercise visibility uses all-students mode or a direct assignment', () => {
  const condition = getExerciseVisibilityCondition(groupMemberId, ROLE.STUDENT);
  const query = dialect.sqlToQuery(condition);

  assert.match(query.sql, /"exercise"\."assignment_mode" = \$1/);
  assert.match(query.sql, /"exercise_assignment"\."exercise_id" = "exercise"\."id"/);
  assert.match(query.sql, /"exercise_assignment"\."group_member_id" = \$2/);
  assert.deepEqual(query.params, ['ALL_STUDENTS', groupMemberId]);
});
