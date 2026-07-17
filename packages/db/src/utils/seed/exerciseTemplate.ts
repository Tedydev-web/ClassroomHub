import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { db, exerciseTemplate } from '@db/drizzle';

import type { TExerciseTemplate } from '@db/types';

type ExerciseTemplateSeed = Pick<TExerciseTemplate, 'title' | 'description' | 'questionnaire' | 'tag'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isExerciseTemplateSeed(value: unknown): value is ExerciseTemplateSeed {
  if (!isRecord(value) || typeof value.title !== 'string') {
    return false;
  }

  if (!isNullableString(value.description) || !isNullableString(value.tag)) {
    return false;
  }

  if (!isRecord(value.questionnaire)) {
    return false;
  }

  return Array.isArray(value.questionnaire.questions);
}

async function loadExerciseTemplates(): Promise<ExerciseTemplateSeed[]> {
  const templatesUrl = new URL('../../../../../apps/dashboard/static/assets/exercise-templates.json', import.meta.url);
  const templatesPath = fileURLToPath(templatesUrl);
  const fileContents = await readFile(templatesPath, 'utf8');
  const parsedTemplates: unknown = JSON.parse(fileContents);

  if (!Array.isArray(parsedTemplates) || !parsedTemplates.every(isExerciseTemplateSeed)) {
    throw new Error(`Invalid exercise template fixture: ${templatesPath}`);
  }

  return parsedTemplates;
}

export async function seedExerciseTemplates() {
  const existingExerciseTemplates = await db.select().from(exerciseTemplate);
  const existingExerciseTemplateTitles = existingExerciseTemplates.map((t) => t.title);

  const templatesData = await loadExerciseTemplates();

  const templatesToInsert = templatesData
    .filter((t) => !existingExerciseTemplateTitles.includes(t.title))
    .map((t) => ({
      title: t.title,
      description: t.description,
      questionnaire: t.questionnaire,
      tag: t.tag
    }));

  if (templatesToInsert.length > 0) {
    await db.insert(exerciseTemplate).values(templatesToInsert);

    console.log(`   ✓ Inserted ${templatesToInsert.length} template(s)`);
  } else {
    console.log('   ✓ Templates already exist, skipping');
  }
}
