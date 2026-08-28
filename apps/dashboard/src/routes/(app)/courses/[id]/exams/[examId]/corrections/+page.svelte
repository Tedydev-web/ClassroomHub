<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import ExamAnswerKeyEditor from '$features/exam/exam-answer-key-editor.svelte';
  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';
  import { Button } from '@cio/ui/base/button';
  import * as Alert from '@cio/ui/base/alert';
  import * as Page from '@cio/ui/base/page';

  /**
   * Correcting an answer key after the exam has been sat.
   *
   * Every action here re-marks the class, so the snackbar reports how many results moved
   * rather than saying "saved". A correction that changed nothing is worth knowing about
   * too: it usually means the teacher corrected a question nobody reached.
   */
  let { data } = $props();

  // Seeded from the loader and replaced by the server's own view after every correction,
  // so the key on screen is always the key a further correction would be measured against.
  let questions = $state(data.questions);
  let busyQuestionId = $state<number | null>(null);

  async function reload() {
    const response = await classroomhub.exam[':examId']['answer-keys'].$get({ param: { examId: data.examId } });
    const body = await response.json();

    if ('success' in body && body.success) {
      questions = body.data;
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
        await reload();
      } else {
        // The server's own words: a stale key says exactly what went wrong and what to do,
        // and replacing that with a generic failure would lose the instruction.
        snackbar.error('error' in body ? String(body.error) : $t('exam.corrections.failed'));
        await reload();
      }
    } finally {
      busyQuestionId = null;
    }
  }

  type KeyQuestion = (typeof data.questions)[number];

  function fix(question: KeyQuestion, correctedKey: string[]) {
    return submit(question.questionId, {
      kind: 'keyFix',
      questionId: question.questionId,
      // Echoed from what the server last reported, never composed here: it is the check
      // that another teacher has not corrected this question in the meantime.
      previousKey: question.effectiveKey,
      correctedKey
    });
  }

  function award(question: KeyQuestion) {
    return submit(question.questionId, { kind: 'award', questionId: question.questionId });
  }
</script>

<Page.Root class="mx-auto flex w-[90%] px-4 md:max-w-3xl lg:max-w-4xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{data.title}</Page.Title>
      <Page.Subtitle>{$t('exam.corrections.title')}</Page.Subtitle>
    </Page.HeaderContent>
    <Button variant="outline" href={`/courses/${data.courseId}/exams/${data.examId}/results`}>
      {$t('exam.manage.results')}
    </Button>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <div class="ui:space-y-6">
        <Alert.Root>
          <Alert.Description>{$t('exam.corrections.help')}</Alert.Description>
        </Alert.Root>

        <ExamAnswerKeyEditor {questions} {busyQuestionId} onfix={fix} onaward={award} />
      </div>
    {/snippet}
  </Page.Body>
</Page.Root>
