<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { AssessmentItemRenderer, QuestionNavigation } from '@cio/ui/custom/exercise-question';
  import { Progress } from '@cio/ui/base/progress';
  import {
    getAssessmentVerticalSliceResponseProgress,
    type AssessmentDeliveryDefinition,
    type AssessmentResponseEnvelope
  } from '@cio/question-types';
  import { getAssessmentPassageWorkspaceLabels } from '$features/course/components/exercise/question-labels';

  import ExamCountdown from '$features/exam/exam-countdown.svelte';
  import ExamEntryForm from '$features/exam/exam-entry-form.svelte';
  import { clockOffsetMs, createAutosaveQueue } from '$features/exam/exam-autosave';
  import { classroomhub } from '$lib/utils/services/api';

  /**
   * Sitting a paper without an account.
   *
   * The renderer is the one built for passage papers — it already pins the passage, pages
   * one question at a time on a phone, and highlights the gap belonging to the current
   * question. It takes a definition and a response and emits changes; where those changes
   * go is this page's business, which is exactly the seam an exam needs.
   *
   * `public-course/exercise-view` is deliberately not reused. That component grades in the
   * browser and keeps its attempts in `localStorage` — the behaviour being replaced here —
   * and reusing it would leave browser-side grading one prop away from running.
   */
  let { data } = $props();

  type Stage = 'entry' | 'sitting' | 'submitted';

  let stage = $state<Stage>('entry');
  let starting = $state(false);
  let entryError = $state<string | null>(null);

  let attemptId = $state<string | null>(null);
  let paper = $state<{ questions: Array<{ questionId: number; definition: AssessmentDeliveryDefinition }> } | null>(
    null
  );
  let expiresAt = $state<string | null>(null);
  let offset = $state(0);

  const responses = $state<Record<number, AssessmentResponseEnvelope>>({});
  let saveState = $state<'saved' | 'saving' | 'unsaved'>('saved');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  // Only ever set when the teacher chose to show it; the server decides, not this page.
  let revealedResult = $state<{ score: string; total: string } | null>(null);

  const queue = createAutosaveQueue({
    send: async (answers) => {
      if (!attemptId) return;

      await classroomhub['exam-sitting'].attempt[':attemptId'].answers.$put(
        { param: { attemptId }, json: { answers } },
        { headers: { 'x-exam-sitting': '1' } }
      );
    }
  });

  // A debounced save and an interval save deliberately overlap; the queue is built for it.
  const AUTOSAVE_EVERY_MS = 15_000;
  $effect(() => {
    if (stage !== 'sitting') return;

    const timer = setInterval(async () => {
      await queue.flush();
      saveState = queue.state();
    }, AUTOSAVE_EVERY_MS);

    return () => clearInterval(timer);
  });

  async function start(details: { displayName: string; className: string; candidateNumber: string; password: string }) {
    starting = true;
    entryError = null;

    try {
      const response = await classroomhub['exam-sitting'][':slug'].start.$post(
        { param: { slug: data.slug }, json: details },
        { headers: { 'x-exam-sitting': '1' } }
      );
      const body = await response.json();

      if (!('success' in body) || !body.success) {
        entryError = 'error' in body ? String(body.error) : $t('exam.manage.open_failed');
        return;
      }

      attemptId = body.data.attemptId;
      paper = body.data.paper;
      expiresAt = body.data.expiresAt ?? null;
      // Measured once, so a device whose clock has drifted still sees the server's time.
      offset = clockOffsetMs(body.data.serverNow ?? new Date().toISOString());
      stage = 'sitting';
    } catch {
      entryError = $t('exam.sitting.start_failed');
    } finally {
      starting = false;
    }
  }

  function answered(questionId: number, response: AssessmentResponseEnvelope) {
    responses[questionId] = response;
    queue.enqueue({ questionId, answerData: response });
    saveState = 'unsaved';
  }

  async function submit() {
    if (!attemptId || submitting) return;

    submitting = true;
    submitError = null;

    try {
      // Everything outstanding goes first. Submitting with work still queued would be the
      // one moment losing it matters most.
      await queue.flush();
      saveState = queue.state();

      if (saveState === 'unsaved') {
        submitError = $t('exam.sitting.unsaved_blocks_submit');
        return;
      }

      const response = await classroomhub['exam-sitting'].attempt[':attemptId'].submit.$post(
        { param: { attemptId } },
        { headers: { 'x-exam-sitting': '1' } }
      );
      const body = await response.json();

      if ('success' in body && body.success) {
        revealedResult = body.data.result ?? null;
      }

      stage = 'submitted';
    } catch {
      submitError = $t('exam.sitting.submit_failed');
    } finally {
      submitting = false;
    }
  }

  /**
   * The convenience path only. Phase 4 finalises an expired attempt from whatever was
   * saved, so a failure here costs nothing — and saying so plainly beats pretending.
   */
  async function onTimeUp() {
    await submit();
  }

  /**
   * Asked once, before the entry screen appears. A refresh mid-paper must continue the
   * same attempt with the time already spent gone — otherwise the student loses their work
   * and gains a fresh clock, which is the wrong outcome twice over.
   */
  $effect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await classroomhub['exam-sitting'][':slug'].resume.$get(
          { param: { slug: data.slug } },
          { headers: { 'x-exam-sitting': '1' } }
        );
        const body = await response.json();

        if (cancelled || !('success' in body) || !body.success || !body.data) return;

        attemptId = body.data.attemptId;
        paper = body.data.paper;
        expiresAt = body.data.expiresAt ?? null;
        offset = clockOffsetMs(body.data.serverNow);

        for (const saved of body.data.answers ?? []) {
          responses[saved.questionId] = saved.answerData;
        }

        stage = 'sitting';
      } catch {
        // No resume is not an error: it only means this browser has not started yet.
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  /**
   * Rendering is the exercise page's, not a second one built for exams.
   *
   * Everything below mirrors `view-mode.svelte`: the same renderer, the same passage
   * workspace labels, the same container and header rules, and the same continuous
   * numbering across items. A paper sat as an exam should look like a paper sat as an
   * exercise, because it is the same paper.
   */
  const passageWorkspaceLabels = $derived(getAssessmentPassageWorkspaceLabels());

  /** Answered and total counted per interaction, so a passage of six counts as six. */
  const progress = $derived.by(() => {
    let answered = 0;
    let total = 0;

    for (const question of paper?.questions ?? []) {
      const counted = getAssessmentVerticalSliceResponseModelProgress(question);
      answered += counted.answered;
      total += counted.total;
    }

    return { answered, total };
  });

  const unansweredCount = $derived(progress.total - progress.answered);

  function getAssessmentVerticalSliceResponseModelProgress(question: {
    questionId: number;
    definition: AssessmentDeliveryDefinition;
  }): { answered: number; total: number } {
    return getAssessmentVerticalSliceResponseProgress(
      question.definition,
      (responses[question.questionId] ?? null) as AssessmentResponseEnvelope | null
    );
  }

  /**
   * The number the sitter sees beside each question, continuous across the whole paper.
   * A passage holding six questions advances the count by six, so question seven really
   * is the seventh question rather than the second item.
   */
  /**
   * One item at a time, with the same Previous/Next/Finish control the exercise page uses.
   * A paper of forty questions in one scroll is a different product from the one the
   * course already teaches with, and the passage workspace is built to own the viewport.
   */
  let currentIndex = $state(1);
  const items = $derived(paper?.questions ?? []);
  const currentItem = $derived(items[currentIndex - 1]);
  const isLastItem = $derived(currentIndex >= items.length);

  function goPrevious() {
    if (currentIndex > 1) currentIndex -= 1;
  }

  async function goNext() {
    if (!isLastItem) {
      currentIndex += 1;
      return;
    }

    await submit();
  }

  const numberStartByQuestionId = $derived.by(() => {
    const starts: Record<number, number> = {};
    let next = 1;

    for (const question of paper?.questions ?? []) {
      starts[question.questionId] = next;
      next += getAssessmentVerticalSliceResponseModelProgress(question).total;
    }

    return starts;
  });
</script>

{#if stage === 'entry'}
  <ExamEntryForm
    title={data.exam.title}
    requiresName={data.exam.requiresName}
    requiresClass={data.exam.requiresClass}
    requiresCandidateNumber={data.exam.requiresCandidateNumber}
    requiresPassword={data.exam.requiresPassword}
    workingMinutes={data.exam.workingSeconds ? Math.round(data.exam.workingSeconds / 60) : null}
    {starting}
    error={entryError}
    onstart={start}
  />
{:else if stage === 'sitting'}
  <div class="ui:flex ui:min-h-dvh ui:flex-col">
    <header
      class="ui:border-border ui:bg-background ui:sticky ui:top-0 ui:z-20 ui:flex ui:items-center ui:justify-between ui:gap-3 ui:border-b ui:px-4 ui:py-3"
    >
      <p class="ui:truncate ui:text-sm ui:font-semibold">{data.exam.title}</p>
      <div class="ui:flex ui:shrink-0 ui:items-center ui:gap-3">
        <!-- Never says "saved" while anything is outstanding. -->
        <span class="ui:text-muted-foreground ui:text-xs">
          {saveState === 'saved'
            ? $t('exam.sitting.saved')
            : saveState === 'saving'
              ? $t('exam.sitting.saving')
              : $t('exam.sitting.unsaved')}
        </span>
        <ExamCountdown {expiresAt} clockOffsetMs={offset} onexpired={onTimeUp} />
      </div>
    </header>

    <main class="ui:mx-auto ui:w-full ui:max-w-5xl ui:flex-1 ui:space-y-4 ui:px-4 ui:pt-6 ui:pb-4">
      {#if currentItem}
        {#key currentItem.questionId}
          <AssessmentItemRenderer
            definition={currentItem.definition}
            response={responses[currentItem.questionId]}
            disabled={submitting}
            questionNumber={numberStartByQuestionId[currentItem.questionId]}
            interactionNumberStart={numberStartByQuestionId[currentItem.questionId]}
            showItemHeader={currentItem.definition?.presentation?.layout !== 'passage_split'}
            showContainer
            trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
            falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
            {passageWorkspaceLabels}
            onResponseChange={(response) => answered(currentItem.questionId, response)}
          />
        {/key}
      {/if}
    </main>

    <footer
      class="ui:border-border ui:bg-background ui:sticky ui:bottom-0 ui:flex ui:items-center ui:justify-between ui:gap-3 ui:border-t ui:px-4 ui:py-3"
    >
      <div class="ui:flex ui:min-w-0 ui:flex-1 ui:items-center ui:gap-3">
        <Progress
          value={progress.total > 0 ? (progress.answered / progress.total) * 100 : 0}
          class="ui:h-2 ui:max-w-48"
        />
        <span class="ui:text-muted-foreground ui:shrink-0 ui:text-xs">
          {unansweredCount > 0
            ? $t('exam.sitting.unanswered', { count: String(unansweredCount) })
            : $t('exam.sitting.all_answered')}
        </span>
      </div>
      <!--
        Paging between items lives here rather than under the paper. The passage workspace
        already carries its own previous/next for the questions inside one passage, and a
        second pair directly beneath it read as a broken duplicate of the first.
      -->
      <QuestionNavigation
        canGoBack={currentIndex > 1}
        canGoNext={!submitting}
        isLast={isLastItem}
        isSubmitting={submitting}
        previousLabel={$t('course.navItem.lessons.exercises.all_exercises.previous')}
        nextLabel={$t('course.navItem.lessons.exercises.all_exercises.next')}
        finishLabel={$t('exam.sitting.submit')}
        onPrevious={goPrevious}
        onNext={goNext}
      />
    </footer>

    {#if submitError}
      <p class="ui:text-destructive ui:px-4 ui:pb-4 ui:text-sm" role="alert">{submitError}</p>
    {/if}
  </div>
{:else}
  <div class="ui:mx-auto ui:max-w-md ui:space-y-3 ui:px-4 ui:py-16 ui:text-center">
    <h1 class="ui:text-xl ui:font-semibold">{$t('exam.sitting.submitted_title')}</h1>

    {#if revealedResult}
      <p class="ui:tabular-nums ui:text-3xl ui:font-semibold">
        {revealedResult.score}/{revealedResult.total}
      </p>
    {/if}

    <p class="ui:text-muted-foreground ui:text-sm">
      {$t('exam.sitting.submitted_body')}
    </p>
  </div>
{/if}
