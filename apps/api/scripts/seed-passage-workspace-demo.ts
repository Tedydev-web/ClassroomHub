import 'dotenv/config';

import {
  createAssessmentItemForCourseService,
  getAssessmentItemForAuthorService,
  publishAssessmentItemForCourseService
} from '@cio/core/services/exercise/assessment-item';
import { and, course, courseSection, db, eq, exercise, group, isNull, lesson, question } from '@cio/db/drizzle';
import {
  QUESTION_TYPE_IDS,
  canonicalizeAssessmentItemDefinition,
  type AssessmentBlock,
  type AssessmentInteractionBlock,
  type AssessmentItemDefinition
} from '@cio/question-types';

const TEST_ORGANIZATION_ID = '1a1dcddd-1abc-4f72-b644-0bd18191a289';
const REACT_GROUP_ID = '04a250f1-bcb9-4e0d-a3d4-a01096e7a105';
const ADMIN_USER_ID = '7ac00503-8519-43c8-a5ea-b79aeca900b1';
const COURSE_ID = 'ee340c69-f766-46af-b8db-a2d060f57bda';
const COURSE_SECTION_ID = '3a19302c-496d-42a3-9c13-cb61d4b366eb';
const LESSON_ID = '97bc4990-e0af-4c3d-9eb9-a810a7fb2cb1';
const EXERCISE_ID = 'bde5531e-86ad-4616-93b4-cdb14d999a76';
const ASSESSMENT_TITLE = 'Reading passage: Help Vietnam Recover';

const assessmentDefinition = {
  schemaVersion: 1,
  presentation: { layout: 'passage_split' },
  blocks: [
    {
      id: 'passage-help-vietnam',
      kind: 'content',
      content: {
        format: 'html',
        html: [
          '<p><strong>Passage 1 - Questions 1-6</strong></p>',
          '<p><em>Read the following advertisement and choose the option that best fits each numbered blank.</em></p>',
          '<h2>Help Vietnam Recover from Typhoon Bualoi!</h2>',
          '<p>Northern and central Vietnam are still reeling from the devastating impact of Typhoon Bualoi, <strong>(1)</strong> has claimed over 50 lives, left many missing or injured, and destroyed more than 230,000 homes.</p>',
          '<p>Entire communities are struggling without electricity, clean water, or food, and agricultural losses have threatened food security, leaving families <strong>(2)</strong>. You can now <strong>(3)</strong> a tangible difference: donations to the Vietnam Fatherland Front, Vietnam Red Cross, and <strong>(4)</strong> trusted organizations provide urgent relief, including temporary housing, medical aid, clean water, food, and support <strong>(5)</strong> schools and local infrastructure.</p>',
          '<p>Major <strong>(6)</strong> such as Vingroup have already pledged millions to aid recovery. Every donation, big or small, helps families survive, recover, and rebuild stronger communities.</p>'
        ].join('')
      }
    },
    {
      id: 'question-1',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Choose the best answer for blank <strong>(1)</strong>.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [
            { id: 'q1-that', html: 'that' },
            { id: 'q1-when', html: 'when' },
            { id: 'q1-which', html: 'which' },
            { id: 'q1-where', html: 'where' }
          ],
          correctOptionIds: ['q1-which']
        }
      }
    },
    {
      id: 'question-2',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Choose the best answer for blank <strong>(2)</strong>.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [
            { id: 'q2-manageable', html: 'manageable' },
            { id: 'q2-adaptable', html: 'adaptable' },
            { id: 'q2-vulnerable', html: 'vulnerable' },
            { id: 'q2-unstoppable', html: 'unstoppable' }
          ],
          correctOptionIds: ['q2-vulnerable']
        }
      }
    },
    {
      id: 'question-3',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Choose the best answer for blank <strong>(3)</strong>.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [
            { id: 'q3-set', html: 'set' },
            { id: 'q3-make', html: 'make' },
            { id: 'q3-hit', html: 'hit' },
            { id: 'q3-take', html: 'take' }
          ],
          correctOptionIds: ['q3-make']
        }
      }
    },
    {
      id: 'question-4',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Choose the best answer for blank <strong>(4)</strong>.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [
            { id: 'q4-another', html: 'another' },
            { id: 'q4-others', html: 'others' },
            { id: 'q4-other', html: 'other' },
            { id: 'q4-the-other', html: 'the other' }
          ],
          correctOptionIds: ['q4-other']
        }
      }
    },
    {
      id: 'question-5',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Choose the best answer for blank <strong>(5)</strong>.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [
            { id: 'q5-for', html: 'for' },
            { id: 'q5-to', html: 'to' },
            { id: 'q5-with', html: 'with' },
            { id: 'q5-from', html: 'from' }
          ],
          correctOptionIds: ['q5-for']
        }
      }
    },
    {
      id: 'question-6',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Choose the best answer for blank <strong>(6)</strong>.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [
            { id: 'q6-corporations', html: 'corporations' },
            { id: 'q6-corporation', html: 'corporation' },
            { id: 'q6-corporate', html: 'corporate' },
            { id: 'q6-corporately', html: 'corporately' }
          ],
          correctOptionIds: ['q6-corporations']
        }
      }
    }
  ],
  feedback: []
} satisfies AssessmentItemDefinition;

interface ChoiceQuestionSeed {
  number: number;
  options: Array<{ id: string; html: string }>;
  correctOptionId: string;
}

function createChoiceQuestionBlock(questionSeed: ChoiceQuestionSeed): AssessmentInteractionBlock {
  return {
    id: `question-${questionSeed.number}`,
    kind: 'interaction',
    interaction: {
      kind: 'choice',
      prompt: {
        format: 'html',
        html: `<p>Choose the best answer for blank <strong>(${questionSeed.number})</strong>.</p>`
      },
      required: true,
      maxScore: 1,
      config: {
        cardinality: 'single',
        presentation: 'list',
        options: questionSeed.options,
        correctOptionIds: [questionSeed.correctOptionId]
      }
    }
  };
}

const financialHabitsQuestions: ChoiceQuestionSeed[] = [
  {
    number: 7,
    options: [
      { id: 'q7-stronger-planning', html: 'stronger financial planning' },
      { id: 'q7-planning-financially', html: 'planning financially' },
      { id: 'q7-planned-finances', html: 'planned finances' },
      { id: 'q7-financially-plan', html: 'financially plan' }
    ],
    correctOptionId: 'q7-stronger-planning'
  },
  {
    number: 8,
    options: [
      { id: 'q8-enhances', html: 'enhances' },
      { id: 'q8-enhanced', html: 'enhanced' },
      { id: 'q8-enhancing', html: 'enhancing' },
      { id: 'q8-enhance', html: 'enhance' }
    ],
    correctOptionId: 'q8-enhances'
  },
  {
    number: 9,
    options: [
      { id: 'q9-and', html: 'and' },
      { id: 'q9-but', html: 'but' },
      { id: 'q9-because', html: 'because' },
      { id: 'q9-although', html: 'although' }
    ],
    correctOptionId: 'q9-and'
  },
  {
    number: 10,
    options: [
      { id: 'q10-creating', html: 'creating' },
      { id: 'q10-create', html: 'create' },
      { id: 'q10-created', html: 'created' },
      { id: 'q10-creation', html: 'creation' }
    ],
    correctOptionId: 'q10-creating'
  },
  {
    number: 11,
    options: [
      { id: 'q11-grow', html: 'grow' },
      { id: 'q11-grows', html: 'grows' },
      { id: 'q11-grew', html: 'grew' },
      { id: 'q11-growing', html: 'growing' }
    ],
    correctOptionId: 'q11-grow'
  },
  {
    number: 12,
    options: [
      { id: 'q12-consistently', html: 'consistently' },
      { id: 'q12-consistency', html: 'consistency' },
      { id: 'q12-consistent', html: 'consistent' },
      { id: 'q12-consist', html: 'consist' }
    ],
    correctOptionId: 'q12-consistently'
  }
];

const sustainableCitiesQuestions: ChoiceQuestionSeed[] = [
  {
    number: 13,
    options: [
      { id: 'q13-dependent', html: 'dependent' },
      { id: 'q13-dependence', html: 'dependence' },
      { id: 'q13-depend', html: 'depend' },
      { id: 'q13-independently', html: 'independently' }
    ],
    correctOptionId: 'q13-dependent'
  },
  {
    number: 14,
    options: [
      { id: 'q14-reduction', html: 'reduction' },
      { id: 'q14-reduce', html: 'reduce' },
      { id: 'q14-reduced', html: 'reduced' },
      { id: 'q14-reducing', html: 'reducing' }
    ],
    correctOptionId: 'q14-reduction'
  },
  {
    number: 15,
    options: [
      { id: 'q15-absorb', html: 'absorb' },
      { id: 'q15-absorbing', html: 'absorbing' },
      { id: 'q15-absorbed', html: 'absorbed' },
      { id: 'q15-absorption', html: 'absorption' }
    ],
    correctOptionId: 'q15-absorb'
  },
  {
    number: 16,
    options: [
      { id: 'q16-participate', html: 'participate' },
      { id: 'q16-participation', html: 'participation' },
      { id: 'q16-participant', html: 'participant' },
      { id: 'q16-participatory', html: 'participatory' }
    ],
    correctOptionId: 'q16-participate'
  },
  {
    number: 17,
    options: [
      { id: 'q17-with', html: 'with' },
      { id: 'q17-by', html: 'by' },
      { id: 'q17-for', html: 'for' },
      { id: 'q17-at', html: 'at' }
    ],
    correctOptionId: 'q17-with'
  },
  {
    number: 18,
    options: [
      { id: 'q18-most', html: 'most' },
      { id: 'q18-more', html: 'more' },
      { id: 'q18-much', html: 'much' },
      { id: 'q18-many', html: 'many' }
    ],
    correctOptionId: 'q18-most'
  }
];

const additionalAssessmentBlocks: AssessmentBlock[] = [
  {
    id: 'passage-financial-habits',
    kind: 'content',
    content: {
      format: 'html',
      html: [
        '<p><strong>Passage 2 - Questions 7-12</strong></p>',
        '<p><em>Read the following leaflet and choose the option that best fits each numbered blank.</em></p>',
        '<h2>Master Your Finances - Building Strong Money Habits</h2>',
        '<p>Surveys indicate that 40% of adults live paycheck to paycheck, highlighting the need for <strong>(7)</strong>. Effective money management not only addresses this challenge but also <strong>(8)</strong> long-term stability, as individuals who maintain emergency funds and monitor spending consistently report lower stress <strong>(9)</strong> greater satisfaction with their personal finances.</p>',
        '<p>Experts recommend <strong>(10)</strong> a realistic monthly budget, reviewing subscriptions, and saving automatically. Even a small amount set aside each week can <strong>(11)</strong> into a meaningful safety net over time. The most sustainable habits are those that people can repeat <strong>(12)</strong> without feeling deprived.</p>'
      ].join('')
    }
  },
  ...financialHabitsQuestions.map(createChoiceQuestionBlock),
  {
    id: 'passage-sustainable-cities',
    kind: 'content',
    content: {
      format: 'html',
      html: [
        '<p><strong>Passage 3 - Questions 13-18</strong></p>',
        '<p><em>Read the following article and choose the option that best fits each numbered blank.</em></p>',
        '<h2>Cities Learning to Breathe Again</h2>',
        '<p>Many fast-growing cities are searching for ways to improve air quality without slowing economic activity. One solution is to expand public transport so commuters are less <strong>(13)</strong> on private vehicles. Cities that introduce reliable bus and rail networks often report a measurable traffic congestion <strong>(14)</strong> within a few years.</p>',
        '<p>Green corridors also help by allowing trees and vegetation to <strong>(15)</strong> pollutants from the air. These projects work best when residents are invited to <strong>(16)</strong> in planning decisions. Digital sensors can provide officials <strong>(17)</strong> real-time evidence about pollution hotspots, enabling resources to be directed where they are needed <strong>(18)</strong>.</p>'
      ].join('')
    }
  },
  ...sustainableCitiesQuestions.map(createChoiceQuestionBlock)
];

const completeAssessmentDefinition = {
  ...assessmentDefinition,
  blocks: [...assessmentDefinition.blocks, ...additionalAssessmentBlocks]
} satisfies AssessmentItemDefinition;

async function seedPassageWorkspaceDemo(): Promise<void> {
  const [existingGroup] = await db
    .select({ id: group.id })
    .from(group)
    .where(and(eq(group.id, REACT_GROUP_ID), eq(group.organizationId, TEST_ORGANIZATION_ID)))
    .limit(1);
  if (!existingGroup) {
    throw new Error('The udemy-test React group is missing. Run the default database seed first.');
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(course)
      .values({
        id: COURSE_ID,
        title: 'Demo: Passage-based Assessment',
        description: 'A ready-to-edit course demonstrating the passage and question exercise workspace.',
        overview: '<p>Use this course to test passage-based assessment authoring and delivery.</p>',
        groupId: REACT_GROUP_ID,
        isTemplate: false,
        logo: '',
        slug: 'passage-based-assessment-demo',
        metadata: {
          goals: 'Create and preview a passage with multiple related questions.',
          grading: true,
          description: '',
          requirements: '',
          lessonDownload: false,
          allowNewStudent: true
        },
        cost: 0,
        currency: 'USD',
        isPublished: true,
        certificate: { isDownloadable: false, theme: 'professional' },
        status: 'ACTIVE'
      })
      .onConflictDoNothing({ target: course.id });

    await tx
      .insert(courseSection)
      .values({
        id: COURSE_SECTION_ID,
        courseId: COURSE_ID,
        title: 'Passage Assessment Demo',
        order: 0
      })
      .onConflictDoNothing({ target: courseSection.id });

    await tx
      .insert(lesson)
      .values({
        id: LESSON_ID,
        courseId: COURSE_ID,
        sectionId: COURSE_SECTION_ID,
        title: 'Reading Comprehension',
        teacherId: ADMIN_USER_ID,
        order: 0,
        isUnlocked: true,
        public: true,
        slug: 'reading-comprehension',
        videos: []
      })
      .onConflictDoNothing({ target: lesson.id });

    await tx
      .insert(exercise)
      .values({
        id: EXERCISE_ID,
        courseId: COURSE_ID,
        sectionId: COURSE_SECTION_ID,
        lessonId: LESSON_ID,
        title: 'Passage and Question Panel Demo',
        description: '<p>Edit this exercise to explore the new passage authoring workspace.</p>',
        order: 0,
        slug: 'passage-and-question-panel-demo',
        isUnlocked: true,
        allowMultipleAttempts: true,
        sectionDisplayMode: 'one_question'
      })
      .onConflictDoNothing({ target: exercise.id });
  });

  const [existingAssessment] = await db
    .select({ id: question.id, currentRevisionId: question.currentRevisionId })
    .from(question)
    .where(
      and(
        eq(question.exerciseId, EXERCISE_ID),
        eq(question.questionTypeId, QUESTION_TYPE_IDS.ASSESSMENT_ITEM),
        isNull(question.archivedAt)
      )
    )
    .limit(1);

  let questionId = existingAssessment?.id;
  if (existingAssessment && !existingAssessment.currentRevisionId) {
    throw new Error(`Assessment question "${existingAssessment.id}" exists without a published revision.`);
  }
  if (!existingAssessment) {
    const createdAssessment = await createAssessmentItemForCourseService(
      COURSE_ID,
      EXERCISE_ID,
      ASSESSMENT_TITLE,
      completeAssessmentDefinition
    );
    questionId = createdAssessment.questionId;
  } else {
    const currentAssessment = await getAssessmentItemForAuthorService(COURSE_ID, EXERCISE_ID, existingAssessment.id);
    const currentDefinition = canonicalizeAssessmentItemDefinition(currentAssessment.definition);
    const completeDefinition = canonicalizeAssessmentItemDefinition(completeAssessmentDefinition);
    const assessmentChanged = currentDefinition !== completeDefinition || currentAssessment.title !== ASSESSMENT_TITLE;

    if (assessmentChanged) {
      const publishedAssessment = await publishAssessmentItemForCourseService(
        COURSE_ID,
        EXERCISE_ID,
        existingAssessment.id,
        ASSESSMENT_TITLE,
        currentAssessment.revision,
        completeAssessmentDefinition
      );
      questionId = publishedAssessment.questionId;
    }
  }

  console.log('Passage workspace demo is ready.');
  console.log(`Course: http://localhost:8000/courses/${COURSE_ID}`);
  console.log(`Exercise: http://localhost:8000/courses/${COURSE_ID}/exercises/${EXERCISE_ID}`);
  console.log(`Assessment question: ${questionId}`);
  console.log('Passages: 3');
  console.log('Questions: 18');
}

seedPassageWorkspaceDemo()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Failed to seed passage workspace demo:', error);
    process.exit(1);
  });
