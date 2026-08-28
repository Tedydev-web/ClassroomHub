<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { AssessmentItemRenderer } from '@cio/ui/custom/exercise-question';
  import { Button } from '@cio/ui/base/button';
  import { Badge } from '@cio/ui/base/badge';
  import * as Alert from '@cio/ui/base/alert';
  import * as Empty from '@cio/ui/base/empty';
  import * as Page from '@cio/ui/base/page';

  /**
   * Reading the paper before the link goes out.
   *
   * It earns its place from our own history: the `.docx` import once published forty
   * questions with seventeen answer keys missing, and nobody knew until students sat it.
   * The paper check counts what is wrong; this shows what is there — a question whose
   * options came through as one run of text, or an equation that did not survive the
   * import, is visible here and nowhere else.
   *
   * Deliberately the candidate's view, keys and all removed. Checking the keys is the
   * answer-key screen's job; this one answers what does this look like to sit.
   */
  let { data } = $props();

  const questions = $derived(data.preview?.paper.questions ?? []);
</script>

<Page.Root class="mx-auto flex w-[90%] px-4 md:max-w-3xl lg:max-w-4xl">
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
        {#if data.preview === null}
          <Empty.Root>
            <Empty.Content>
              <Empty.Title>{$t('exam.preview.unavailable')}</Empty.Title>
            </Empty.Content>
          </Empty.Root>
        {:else}
          <Alert.Root>
            <Alert.Description class="ui:space-y-2">
              <span class="ui:block">{$t('exam.preview.help')}</span>
              <Badge variant="secondary">
                {data.preview.frozen ? $t('exam.preview.frozen') : $t('exam.preview.not_frozen')}
              </Badge>
            </Alert.Description>
          </Alert.Root>

          <div class="ui:space-y-4">
            {#each questions as question, index (question.questionId)}
              <AssessmentItemRenderer
                definition={question.definition}
                disabled
                questionNumber={index + 1}
                interactionNumberStart={index + 1}
                showContainer
                trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
                falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
              />
            {/each}
          </div>
        {/if}
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
