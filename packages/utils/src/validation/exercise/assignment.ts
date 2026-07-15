import * as z from 'zod';

const ZGroupMemberIds = z.array(z.string().uuid()).refine((ids) => new Set(ids).size === ids.length, {
  message: 'Student assignments must be unique'
});

export const ZExerciseAssignmentUpdate = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ALL_STUDENTS'),
    groupMemberIds: z.array(z.string().uuid()).max(0).default([])
  }),
  z.object({
    mode: z.literal('SELECTED_STUDENTS'),
    groupMemberIds: ZGroupMemberIds.min(1)
  })
]);

export type TExerciseAssignmentUpdate = z.infer<typeof ZExerciseAssignmentUpdate>;
