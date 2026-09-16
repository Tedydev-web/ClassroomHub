<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Textarea } from '@cio/ui/base/textarea';
  import { Badge } from '@cio/ui/base/badge';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { markAttemptPaper } from '$features/exam/attempt-marking';
  import { interactionQuestionNumbers, questionNumberRanges } from '$features/exam/paper-outline';
  import AttemptActivityPanel from '$features/exam/attempt-activity-panel.svelte';
  import { AssessmentItemRenderer } from '@cio/ui/custom/exercise-question';
  import { getAssessmentPassageWorkspaceLabels } from '$features/course/components/exercise/question-labels';

  import { classroomhub } from '$lib/utils/services/api';
  import { snackbar } from '$features/ui/snackbar/store';

  /**
   * One sitting, in full: what the paper asked, what this person answered, when they
   * changed their mind, and the box a teacher marks in.
   *
   * The teacher sees the answer key. The reveal policy governs what a *student* may see
   * and does not apply here — two call sites over one serializer, different gates.
   */
  let { data } = $props();

  /**
   * Everything the server owns is derived from the loader; only what this page has changed
   * since is held locally. Seeding plain state from `data` captures it at mount, so a
   * navigation back would show the marks and total as they were the first time.
   */
  let edited = $state<Record<number, { score: string; comment: string }>>({});
  /**
   * Marks this page has successfully written, which `data.attempt.manualScores` will not
   * know about until a reload. Kept so reverting an edit returns to what the server
   * actually holds now rather than to the value it held when the page loaded.
   */
  let committed = $state<Record<number, { score: string; comment: string }>>({});
  let saved = $state<{ score: string | null; total: string | null; gradingState: string } | null>(null);

  const marks = $derived({
    ...Object.fromEntries(
      Object.entries(data.attempt.manualScores ?? {}).map(([questionId, mark]) => [
        Number(questionId),
        {
          score: String((mark as { score: number }).score ?? ''),
          comment: (mark as { comment?: string }).comment ?? ''
        }
      ])
    ),
    ...committed,
    ...edited
  });

  let savingQuestionId = $state<number | null>(null);
  const score = $derived(saved?.score ?? data.attempt.score);
  const total = $derived(saved?.total ?? data.attempt.total);
  const gradingState = $derived(saved?.gradingState ?? data.attempt.gradingState);

  const answerByQuestion = $derived(
    new Map(
      ((data.attempt.answers ?? []) as Array<{ questionId: number; answerData: unknown }>).map((answer) => [
        answer.questionId,
        answer.answerData
      ])
    )
  );

  /** Every change this sitter made, in order — what a dispute about a result needs. */
  const trailByQuestion = $derived.by(() => {
    const grouped = new Map<number, Array<{ at: string }>>();

    for (const entry of (data.attempt.answerLog ?? []) as Array<{ at: string; questionId: number }>) {
      grouped.set(entry.questionId, [...(grouped.get(entry.questionId) ?? []), entry]);
    }

    return grouped;
  });

  /**
   * Drop this question's unsaved edit so `marks` falls back to the value the server holds.
   *
   * This is the only undo the data supports. Reverting a mark that was already *saved*
   * would need the API to keep a history of marks, and it does not — `answerLog` records
   * what the sitter changed, not what the marker did.
   */
  function revertMark(questionId: number) {
    const { [questionId]: _discarded, ...rest } = edited;
    edited = rest;
  }

  async function saveMark(questionId: number) {
    const raw = marks[questionId];
    const numeric = Number(raw?.score);

    if (!Number.isFinite(numeric)) {
      snackbar.error($t('exam.results.mark_must_be_number'));
      return;
    }

    savingQuestionId = questionId;

    try {
      const response = await classroomhub.exam.attempt[':attemptId'].mark.$put({
        param: { attemptId: data.attemptId },
        json: { questionId, score: numeric, comment: raw?.comment ?? '' }
      });
      const body = await response.json();

      if ('success' in body && body.success) {
        // Recomputed on the server by the one function that owns the total, so the
        // automatic part and the marks cannot drift apart.
        saved = { score: body.data.score, total: body.data.total, gradingState: body.data.gradingState };
        // This value is now the server's. Moving it out of `edited` both hides the revert
        // control — there is nothing left to discard — and gives a later edit something
        // truthful to revert to.
        committed = { ...committed, [questionId]: { score: String(numeric), comment: raw?.comment ?? '' } };
        const { [questionId]: _justSaved, ...stillEdited } = edited;
        edited = stillEdited;
        snackbar.success($t('exam.results.mark_saved'));
      } else {
        snackbar.error($t('exam.results.mark_failed'));
      }
    } catch {
      // The API client throws on any non-2xx, so without this a rejected save fell through
      // silently: no message, the button re-enabled, and the teacher believed the mark had
      // landed.
      snackbar.error($t('exam.results.mark_failed'));
    } finally {
      savingQuestionId = null;
    }
  }

  /** The paper as a marker reads it. Derived in a module so it can be tested without a browser. */
  const markedItems = $derived(markAttemptPaper(data.paper?.questions ?? [], answerByQuestion));

  /**
   * Which numbers each item covers, read off the same paper the marking below is read off.
   * The activity log records item ids, and an id means nothing to somebody holding the paper.
   */
  const numberRanges = $derived(questionNumberRanges(data.paper?.questions ?? []));

  /** The exact number behind each stored answer, so the log can name the question itself. */
  const questionNumbers = $derived(interactionQuestionNumbers(data.paper?.questions ?? []));

  const passageWorkspaceLabels = $derived(getAssessmentPassageWorkspaceLabels());

  /**
   * The marking of each question, reachable by the interaction the renderer names.
   *
   * The paper is drawn by the renderer and the verdict is this page's, so the two meet on the
   * interaction id — the only name they both know. Deriving it from the marked items rather
   * than recomputing keeps one marking on the screen instead of two that can disagree.
   */
  const verdictByInteractionId = $derived(
    new Map(
      markedItems.flatMap((item) => item.interactions.map((interaction) => [interaction.interactionId, interaction]))
    )
  );
</script>

{#snippet answerVerdict({ interactionId }: { interactionId: string; questionNumber: number })}
  {@const interaction = verdictByInteractionId.get(interactionId)}
  {#if interaction}
    <div class="ui:text-xs">
      <!--
        The verdict reaches a screen reader as a word. The colour and the glyph are the only
        other carriers, and neither is available to one.
      -->
      {#if !interaction.answered}
        <span class="ui:text-muted-foreground ui:italic">{$t('exam.results.not_answered')}</span>
      {:else if interaction.outcome === 'correct'}
        <span class="ui:font-medium text-emerald-600 dark:text-emerald-400">
          <span aria-hidden="true">✓ </span>{$t('exam.results.marked_correct')}
        </span>
      {:else if interaction.outcome === 'incorrect'}
        <span class="ui:text-destructive ui:font-medium">
          <span aria-hidden="true">✗ </span>{$t('exam.results.marked_incorrect')}
        </span>
      {:else if interaction.outcome === 'partial'}
        <span class="ui:font-medium text-amber-600 dark:text-amber-400">
          {$t('exam.results.marked_partial')} ({$t('exam.results.interaction_score', {
            score: String(interaction.score ?? 0),
            max: String(interaction.maxScore)
          })})
        </span>
      {:else if interaction.outcome === 'manual'}
        <span class="ui:text-muted-foreground">{$t('exam.results.awaiting_hand_mark')}</span>
      {:else}
        <span class="ui:text-muted-foreground">{$t('exam.results.marked_unscored')}</span>
      {/if}

      <!--
        Only where the key is not already visible on the options above: a written answer has
        no option to tint, so the expected text has to be said.
      -->
      {#if interaction.outcome !== 'correct' && interaction.outcome !== 'manual' && interaction.correct.length === 0 && interaction.expectedText}
        <span class="ui:text-muted-foreground ui:ml-2">
          {$t('exam.results.expected_answer', { answer: interaction.expectedText })}
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

<Page.Root class="mx-auto flex w-full px-4 md:w-[90%] lg:max-w-4xl">
  <Page.Header>
    <Page.HeaderContent>
      <Page.Title>{data.attempt.displayName ?? $t('exam.results.no_name')}</Page.Title>
      <Page.Subtitle>
        {[data.attempt.className, data.attempt.candidateNumber].filter(Boolean).join(' · ') ||
          $t('exam.results.no_extra_details')}
      </Page.Subtitle>
      <p class="ui:text-sm">
        {$t('exam.results.score_column')}:
        <span class="ui:font-semibold ui:tabular-nums">{score ?? '—'}/{total ?? '—'}</span>
        {#if gradingState === 'awaiting_manual'}
          <span class="ui:text-muted-foreground">— {$t('exam.results.awaiting_manual_note')}</span>
        {:else if gradingState === 'unscoreable'}
          <span class="ui:text-destructive">— {$t('exam.results.unscoreable_note')}</span>
        {/if}
      </p>
    </Page.HeaderContent>
  </Page.Header>

  <Page.Body>
    {#snippet child()}
      <!--
        Above the paper, because it frames how the paper is read — and because a teacher
        who scrolls past forty questions to find it will not find it.
      -->
      <div class="ui:mb-6">
        <AttemptActivityPanel
          activityLog={data.attempt.activityLog}
          answerLog={data.attempt.answerLog}
          {numberRanges}
          {questionNumbers}
        />
      </div>

      <ol class="ui:space-y-4">
        {#each markedItems as item (item.questionId)}
          {@const trail = trailByQuestion.get(item.questionId) ?? []}
          <li class="ui:border-border ui:bg-card ui:space-y-3 ui:rounded-lg ui:border ui:p-4">
            <div class="ui:flex ui:flex-wrap ui:items-center ui:gap-2">
              <p class="ui:text-sm ui:font-semibold">
                {item.lastNumber > item.firstNumber
                  ? $t('exam.results.question_range', {
                      from: String(item.firstNumber),
                      to: String(item.lastNumber)
                    })
                  : $t('exam.results.question_label', { number: String(item.firstNumber) })}
              </p>
              {#if item.needsManual}
                <Badge variant="secondary">{$t('exam.results.needs_manual')}</Badge>
              {:else}
                <Badge variant="outline">{$t('exam.results.auto_scored')}</Badge>
              {/if}
              {#if item.autoScore !== null}
                <span class="ui:text-muted-foreground ui:ml-auto ui:text-xs ui:tabular-nums">
                  {$t('exam.results.item_score', {
                    score: String(item.autoScore),
                    max: String(item.maxScore)
                  })}
                </span>
              {/if}
            </div>

            {#if item.unreadable}
              <p class="ui:text-destructive ui:text-sm">{$t('exam.results.unsupported_item')}</p>
            {:else if item.scoreBlocked}
              <p class="ui:text-amber-600 ui:dark:text-amber-400 ui:text-xs">
                {$t('exam.results.score_blocked')}
              </p>
            {/if}

            <!--
              The paper as the candidate saw it, with their answers in place and the key
              beside them. It used to be a compact list — "3. B ✗, correct answer C" — which
              is readable but is not the paper: a marker settling a dispute needs the passage,
              the wording and the options that were on the screen, and had to open another tab
              to see any of it.
            -->
            {#key item.questionId}
              <AssessmentItemRenderer
                definition={item.definition}
                response={answerByQuestion.get(item.questionId)}
                disabled
                revealsKey
                questionNumber={item.firstNumber}
                interactionNumberStart={item.firstNumber}
                showItemHeader={item.definition?.presentation?.layout !== 'passage_split'}
                trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
                falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
                {passageWorkspaceLabels}
                questionActions={answerVerdict}
              />
            {/key}

            {#if trail.length > 1}
              <!-- Settles a dispute about a result, and shows a paper answered all at once. -->
              <p class="ui:text-muted-foreground ui:text-xs">
                {$t('exam.results.changed_answer', { count: String(trail.length - 1) })}
              </p>
            {/if}

            {#if item.needsManual}
              <!--
                One box per item, because a mark is saved against the item's questionId. It
                appears only where a hand mark is actually owed; showing it under every
                auto-scored question was most of what made this screen unreadable.
              -->
              <div class="ui:border-border ui:flex ui:flex-wrap ui:items-end ui:gap-2 ui:border-t ui:pt-3">
                <div class="ui:w-24">
                  <label class="ui:text-muted-foreground ui:text-xs" for={`mark-${item.questionId}`}>
                    {$t('exam.results.score_column')}
                  </label>
                  <Input
                    id={`mark-${item.questionId}`}
                    inputmode="decimal"
                    value={marks[item.questionId]?.score ?? ''}
                    oninput={(event: Event) =>
                      (edited[item.questionId] = {
                        score: (event.currentTarget as HTMLInputElement).value,
                        comment: marks[item.questionId]?.comment ?? ''
                      })}
                  />
                </div>
                <div class="ui:min-w-48 ui:flex-1">
                  <label class="ui:text-muted-foreground ui:text-xs" for={`comment-${item.questionId}`}>
                    {$t('exam.results.comment_column')}
                  </label>
                  <Textarea
                    id={`comment-${item.questionId}`}
                    rows={2}
                    value={marks[item.questionId]?.comment ?? ''}
                    oninput={(event: Event) =>
                      (edited[item.questionId] = {
                        score: marks[item.questionId]?.score ?? '',
                        comment: (event.currentTarget as HTMLTextAreaElement).value
                      })}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={savingQuestionId === item.questionId}
                  onclick={() => saveMark(item.questionId)}
                >
                  {$t('exam.results.save_mark')}
                </Button>
                {#if edited[item.questionId]}
                  <!--
                    Typing over a mark used to be one-way: the number that was there is still
                    on the server, but nothing on screen put it back. Shown only while an
                    unsaved edit exists — after a save the server holds the new value and
                    there is nothing here to return to.
                  -->
                  <Button size="sm" variant="ghost" onclick={() => revertMark(item.questionId)}>
                    {$t('exam.results.revert_mark')}
                  </Button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/snippet}
  </Page.Body>
</Page.Root>
