import { DB_BACKED_QUESTION_TYPE_REGISTRY } from '@cio/question-types';
import { syncQuestionTypeIdSequence } from '@db/queries/exercise';

import { db, questionType, sql } from '@db/drizzle';

/**
 * Seeds `question_type` rows with EXPLICIT registry ids. Seed insertion order is not an ID
 * contract: migration 0011 reserves ASSESSMENT_ITEM at id 16 before any seed runs, so relying
 * on identity order would shift fresh-install rows to ids 17+ and break the code registry.
 * Existing rows are verified against the registry and any occupied identity fails loudly.
 */
export async function seedQuestionTypes() {
  const existingQuestionTypes = await db.select().from(questionType);
  const existingIdByTypename = new Map(
    existingQuestionTypes
      .filter((row): row is typeof row & { typename: string } => typeof row.typename === 'string')
      .map((row) => [row.typename, row.id])
  );

  const questionTypesToInsert: { id: number; label: string; typename: string }[] = [];
  for (const registryEntry of DB_BACKED_QUESTION_TYPE_REGISTRY) {
    const existingId = existingIdByTypename.get(registryEntry.typename);
    if (existingId !== undefined) {
      if (existingId !== registryEntry.id) {
        throw new Error(
          `question_type "${registryEntry.typename}" occupies id ${existingId} but the registry requires id ${registryEntry.id}`
        );
      }

      continue;
    }

    const occupyingRow = existingQuestionTypes.find((row) => row.id === registryEntry.id);
    if (occupyingRow) {
      throw new Error(
        `question_type id ${registryEntry.id} is reserved for "${registryEntry.typename}" but is occupied by "${occupyingRow.typename ?? 'unknown'}"`
      );
    }

    questionTypesToInsert.push({
      id: registryEntry.id,
      label: registryEntry.label,
      typename: registryEntry.typename
    });
  }

  if (questionTypesToInsert.length > 0) {
    await syncQuestionTypeIdSequence();
    await db.insert(questionType).values(questionTypesToInsert);
    console.log(`   ✓ Inserted ${questionTypesToInsert.length} question type(s)`);
  } else {
    console.log('   ✓ Question types already exist, skipping');
  }

  // Explicit-id inserts bypass the identity sequence; realign it so future
  // BY DEFAULT inserts can never collide with reserved registry identities.
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('question_type', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM question_type), 16)
    )
  `);
}
