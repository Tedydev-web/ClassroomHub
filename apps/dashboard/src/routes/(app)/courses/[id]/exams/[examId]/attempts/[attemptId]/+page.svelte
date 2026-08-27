<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Textarea } from '@cio/ui/base/textarea';
  import { Badge } from '@cio/ui/base/badge';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { markAttemptPaper } from '$features/exam/attempt-marking';

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
</script>

<Page.Root class="mx-auto flex w-[90%] px-4 lg:max-w-4xl">
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

            {#if item.sharedHtml}
              <!--
                Collapsed. A marker needs the passage to settle a disputed answer and almost
                never otherwise, and ten passages opened at once bury the forty answers this
                page exists to show.
              -->
              <details class="ui:border-border ui:rounded-md ui:border ui:px-3 ui:py-2">
                <summary class="ui:text-muted-foreground ui:cursor-pointer ui:text-xs">
                  {$t('exam.results.passage')}
                </summary>
                <div class="ui:mt-2 ui:text-sm">
                  <SafeHtmlContent content={item.sharedHtml} />
                </div>
              </details>
            {/if}

            <ol class="ui:divide-border ui:divide-y">
              {#each item.interactions as interaction (interaction.interactionId)}
                {@const tone =
                  interaction.outcome === 'correct'
                    ? 'ui:text-emerald-600 dark:text-emerald-400'
                    : interaction.outcome === 'incorrect'
                      ? 'ui:text-destructive'
                      : interaction.outcome === 'partial'
                        ? 'ui:text-amber-600 ui:dark:text-amber-400'
                        : ''}
                <li class="ui:flex ui:flex-wrap ui:items-baseline ui:gap-x-3 ui:gap-y-1 ui:py-2 ui:text-sm">
                  <span class="ui:text-muted-foreground ui:w-8 ui:shrink-0 ui:tabular-nums">
                    {interaction.number}.
                  </span>

                  {#if !interaction.answered}
                    <span class="ui:text-muted-foreground ui:italic">{$t('exam.results.not_answered')}</span>
                  {:else}
                    <span class="ui:min-w-0 ui:flex-1 [&_p]:m-0 [&_p]:inline {tone}">
                      <!--
                        Keyed by position, not by label. An option id the paper no longer
                        contains resolves to "?", and two of them in one answer would be two
                        identical keys, which Svelte rejects — taking the whole page down
                        rather than the one row.
                      -->
                      {#each interaction.chosen as option, position (position)}
                        <span class="ui:font-semibold">{option.label}.</span>
                        <SafeHtmlContent content={option.html} />
                      {/each}
                      {#if interaction.givenText}{interaction.givenText}{/if}
                      <!--
                        The verdict reaches a screen reader as a word. The glyph and the
                        colour are the only other carriers, and neither is available to one.
                      -->
                      {#if interaction.outcome === 'correct'}
                        <span class="ui:sr-only">{$t('exam.results.marked_correct')}</span>
                        <span aria-hidden="true"> ✓</span>
                      {:else if interaction.outcome === 'incorrect'}
                        <span class="ui:sr-only">{$t('exam.results.marked_incorrect')}</span>
                        <span aria-hidden="true"> ✗</span>
                      {:else if interaction.outcome === 'partial'}
                        <span class="ui:sr-only">{$t('exam.results.marked_partial')}</span>
                        <span class="ui:text-xs ui:tabular-nums">
                          ({$t('exam.results.interaction_score', {
                            score: String(interaction.score ?? 0),
                            max: String(interaction.maxScore)
                          })})
                        </span>
                      {:else if interaction.outcome === 'manual'}
                        <span class="ui:text-muted-foreground ui:text-xs">
                          — {$t('exam.results.awaiting_hand_mark')}
                        </span>
                      {:else}
                        <span class="ui:text-muted-foreground ui:text-xs">
                          — {$t('exam.results.marked_unscored')}
                        </span>
                      {/if}
                    </span>
                  {/if}

                  {#if interaction.outcome !== 'correct' && interaction.outcome !== 'manual'}
                    {#if interaction.correct.length > 0}
                      <span class="ui:text-muted-foreground ui:basis-full ui:pl-8 ui:text-xs">
                        {$t('exam.results.correct_answer', {
                          answer: interaction.correct.map((option) => option.label).join(', ')
                        })}
                      </span>
                    {:else if interaction.expectedText}
                      <span class="ui:text-muted-foreground ui:basis-full ui:pl-8 ui:text-xs">
                        {$t('exam.results.expected_answer', { answer: interaction.expectedText })}
                      </span>
                    {/if}
                  {/if}
                </li>
              {/each}
            </ol>

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
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/snippet}
  </Page.Body>
</Page.Root>
