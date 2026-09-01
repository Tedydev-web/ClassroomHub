<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import ExamCorrectionActions from '$features/exam/exam-correction-actions.svelte';
  import ExamTabs from '$features/exam/exam-tabs.svelte';
  import {
    AssessmentItemRenderer,
    QuestionNavigation,
    SectionNavigationSidebar
  } from '@cio/ui/custom/exercise-question';
  import { getAssessmentPassageWorkspaceLabels } from '$features/course/components/exercise/question-labels';
  import { buildOutlineGroups, questionNumberStarts, type PaperQuestion } from '$features/exam/paper-outline';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import * as Alert from '@cio/ui/base/alert';
  import * as Page from '@cio/ui/base/page';

  /**
   * Correcting an answer key after the exam has been sat.
   *
   * The paper is drawn the way every other screen draws it — passage beside its questions,
   * one item at a time, with the outline to move between them. A teacher judging whether a
   * key is right is reading the same paper the class read, so reading it anywhere else would
   * be a second layout to keep in agreement with the first.
   *
   * What is added on top is the key itself, marked on the options, and the two remedies
   * beneath each question. Every action re-marks the class, so the snackbar reports how many
   * results moved rather than saying "saved": a correction that moved nothing is worth
   * knowing about too, and usually means a question nobody reached.
   */
  let { data } = $props();

  // Seeded from the loader and replaced by the server's own view after every correction, so
  // the key on screen is always the key a further correction would be measured against.
  let questions = $state(data.questions);
  let paper = $state(data.paper);
  let busyQuestionId = $state<number | null>(null);

  let currentIndex = $state(1);

  const items = $derived((paper?.questions ?? []) as PaperQuestion[]);
  const currentItem = $derived(items[currentIndex - 1]);
  const isLastItem = $derived(currentIndex >= items.length);

  const numberStartByQuestionId = $derived(questionNumberStarts(items));
  const passageWorkspaceLabels = $derived(getAssessmentPassageWorkspaceLabels());

  /** The row behind a question on screen, found by the interaction the renderer names. */
  const rowByInteractionId = $derived(new Map(questions.map((question) => [question.interactionId, question])));

  const outlineGroups = $derived(
    buildOutlineGroups(items, {
      currentIndex,
      labels: {
        range: (start, end) =>
          $t('course.navItem.lessons.exercises.all_exercises.assessment_item.passage_workspace_question_range', {
            start,
            end
          }),
        single: (index) =>
          $t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_number', { index })
      }
    })
  );

  async function reload() {
    const response = await classroomhub.exam[':examId']['answer-keys'].$get({ param: { examId: data.examId } });
    const body = await response.json();

    if ('success' in body && body.success) {
      questions = body.data.questions;
      paper = body.data.paper;
    }
  }

  async function submit(questionId: number, json: Record<string, unknown>) {
    busyQuestionId = questionId;

    try {
      const response = await classroomhub.exam[':examId'].corrections.$post({
        param: { examId: data.examId },
        json: json as never
      });
      const body = await response.json();

      if ('success' in body && body.success) {
        snackbar.success($t('exam.corrections.applied', { count: String(body.data.rescored) }));
      } else {
        // The server's own words: a stale key says exactly what went wrong and what to do,
        // and replacing that with a generic failure would lose the instruction.
        snackbar.error('error' in body ? String(body.error) : $t('exam.corrections.failed'));
      }

      await reload();
    } finally {
      busyQuestionId = null;
    }
  }

  type KeyQuestion = (typeof data.questions)[number];

  function fix(question: KeyQuestion, correctedKey: string[]) {
    return submit(question.questionId, {
      kind: 'keyFix',
      questionId: question.questionId,
      // Echoed from what the server last reported, never composed here: it is the check that
      // another teacher has not corrected this question in the meantime.
      previousKey: question.effectiveKey,
      correctedKey
    });
  }

  function award(question: KeyQuestion) {
    return submit(question.questionId, { kind: 'award', questionId: question.questionId });
  }
</script>

<Page.Root class="mx-auto flex w-full px-4 md:w-[90%] md:max-w-3xl lg:max-w-4xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{data.title}</Page.Title>
      <Page.Subtitle>{$t('exam.corrections.title')}</Page.Subtitle>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="ui:space-y-6">
        <ExamTabs courseId={data.courseId} examId={data.examId} />

        <Alert.Root>
          <Alert.Description>{$t('exam.corrections.help')}</Alert.Description>
        </Alert.Root>

        {#if items.length === 0}
          <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.corrections.empty')}</p>
        {:else}
          <SectionNavigationSidebar
            sections={outlineGroups}
            navigationLabel={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_outline')}
            selectLabel={(label) => $t('exam.sitting.go_to_question', { number: label })}
            onSelect={(groupId) => {
              const index = items.findIndex((question) => String(question.questionId) === groupId);
              if (index >= 0) currentIndex = index + 1;
            }}
          />

          {#if currentItem}
            {#key currentItem.questionId}
              <AssessmentItemRenderer
                definition={currentItem.definition}
                disabled
                revealsKey
                questionNumber={numberStartByQuestionId[currentItem.questionId]}
                interactionNumberStart={numberStartByQuestionId[currentItem.questionId]}
                showItemHeader={currentItem.definition?.presentation?.layout !== 'passage_split'}
                showContainer
                trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
                falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
                {passageWorkspaceLabels}
                {questionActions}
              />
            {/key}
          {/if}

          <QuestionNavigation
            canGoBack={currentIndex > 1}
            canGoNext={!isLastItem}
            isLast={isLastItem}
            previousLabel={$t('course.navItem.lessons.exercises.all_exercises.previous')}
            nextLabel={$t('course.navItem.lessons.exercises.all_exercises.next')}
            finishLabel={$t('course.navItem.lessons.exercises.all_exercises.next')}
            onPrevious={() => (currentIndex = Math.max(1, currentIndex - 1))}
            onNext={() => (currentIndex = Math.min(items.length, currentIndex + 1))}
          />
        {/if}
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>

{#snippet questionActions({ interactionId }: { interactionId: string; questionNumber: number })}
  {@const question = rowByInteractionId.get(interactionId)}
  {#if question}
    <ExamCorrectionActions
      {question}
      busy={busyQuestionId === question.questionId}
      onfix={(correctedKey) => fix(question, correctedKey)}
      onaward={() => award(question)}
    />
  {/if}
{/snippet}
