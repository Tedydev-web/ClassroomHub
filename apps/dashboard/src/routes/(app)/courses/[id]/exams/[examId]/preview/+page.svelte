<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import {
    AssessmentItemRenderer,
    QuestionNavigation,
    SectionNavigationSidebar
  } from '@cio/ui/custom/exercise-question';
  import { Button } from '@cio/ui/base/button';
  import { Badge } from '@cio/ui/base/badge';
  import * as Alert from '@cio/ui/base/alert';
  import * as Empty from '@cio/ui/base/empty';
  import * as Page from '@cio/ui/base/page';
  import { getAssessmentPassageWorkspaceLabels } from '$features/course/components/exercise/question-labels';
  import { buildOutlineGroups, questionNumberStarts, type PaperQuestion } from '$features/exam/paper-outline';
  import ExamTabs from '$features/exam/exam-tabs.svelte';

  /**
   * Reading the paper before the link goes out, laid out the way a candidate meets it.
   *
   * It earns its place from our own history: the `.docx` import once published forty
   * questions with seventeen answer keys missing, and nobody knew until students sat it.
   * The paper check counts what is wrong; this shows what is there — options that came
   * through as one run of text, or an equation that did not survive the import, are visible
   * here and nowhere else.
   *
   * One item at a time, with the same outline and the same numbering as the real paper,
   * because a preview that reads differently from the thing it previews is not a preview.
   * An earlier version scrolled every item at once and numbered each from its own position,
   * so a paper of forty questions across ten passages showed a highest number of 17 — it
   * looked like a short paper rather than a broken count.
   *
   * Answer keys are stripped, exactly as they are for a candidate; checking the keys is the
   * answer-key screen's job.
   */
  let { data } = $props();

  const questions = $derived((data.preview?.paper.questions ?? []) as PaperQuestion[]);
  const passageWorkspaceLabels = $derived(getAssessmentPassageWorkspaceLabels());
  const numberStartByQuestionId = $derived(questionNumberStarts(questions));

  let currentIndex = $state(1);
  const currentItem = $derived(questions[currentIndex - 1]);
  const isLastItem = $derived(currentIndex >= questions.length);

  const outlineGroups = $derived(
    buildOutlineGroups(questions, {
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

  /** The paper's real length: passages count for every question they hold. */
  const questionCount = $derived(outlineGroups.reduce((total, group) => total + group.questions.length, 0));
</script>

<Page.Root class="mx-auto flex w-full px-4 md:w-[90%] md:max-w-3xl lg:max-w-4xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{data.title}</Page.Title>
      <Page.Subtitle>{$t('exam.preview.title')}</Page.Subtitle>
    </Page.HeaderContent>
    <Page.Action>
      <Button variant="outline" href={`/courses/${data.courseId}/exams`}>{$t('exam.preview.back')}</Button>
    </Page.Action>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="ui:space-y-6">
        <ExamTabs courseId={data.courseId} examId={data.examId} />

        {#if data.preview === null || questions.length === 0}
          <Empty.Root>
            <Empty.Content>
              <Empty.Title>{$t('exam.preview.unavailable')}</Empty.Title>
            </Empty.Content>
          </Empty.Root>
        {:else}
          <Alert.Root>
            <Alert.Description class="ui:space-y-2">
              <span class="ui:block">{$t('exam.preview.help')}</span>
              <span class="ui:flex ui:flex-wrap ui:gap-2">
                <Badge variant="secondary">
                  {data.preview.frozen ? $t('exam.preview.frozen') : $t('exam.preview.not_frozen')}
                </Badge>
                <Badge variant="outline">
                  {$t('exam.preview.question_count', { count: String(questionCount) })}
                </Badge>
              </span>
            </Alert.Description>
          </Alert.Root>

          <SectionNavigationSidebar
            sections={outlineGroups}
            navigationLabel={$t('course.navItem.lessons.exercises.all_exercises.assessment_item.question_outline')}
            selectLabel={(label) => $t('exam.sitting.go_to_question', { number: label })}
            onSelect={(groupId) => {
              const index = questions.findIndex((question) => String(question.questionId) === groupId);
              if (index >= 0) currentIndex = index + 1;
            }}
          />

          {#if currentItem}
            {#key currentItem.questionId}
              <AssessmentItemRenderer
                definition={currentItem.definition}
                disabled
                questionNumber={numberStartByQuestionId[currentItem.questionId]}
                interactionNumberStart={numberStartByQuestionId[currentItem.questionId]}
                showItemHeader={currentItem.definition?.presentation?.layout !== 'passage_split'}
                showContainer
                trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
                falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
                {passageWorkspaceLabels}
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
            onNext={() => (currentIndex = Math.min(questions.length, currentIndex + 1))}
          />
        {/if}
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
