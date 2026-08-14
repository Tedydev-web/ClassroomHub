<script lang="ts">
  import * as Page from '@cio/ui/base/page';
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Textarea } from '@cio/ui/base/textarea';

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
    } finally {
      savingQuestionId = null;
    }
  }

  function isCorrectOption(questionId: number, optionId: string): boolean {
    const question = data.paper?.questions?.find((entry: { questionId: number }) => entry.questionId === questionId);
    const blocks = (question?.definition?.blocks ?? []) as Array<{
      kind: string;
      interaction?: { kind: string; config?: { correctOptionIds?: string[] } };
    }>;

    return blocks.some(
      (block) => block.kind === 'interaction' && block.interaction?.config?.correctOptionIds?.includes(optionId)
    );
  }

  function chosenOptionIds(questionId: number): string[] {
    const answer = answerByQuestion.get(questionId) as
      | { responses?: Array<{ response?: { selectedOptionIds?: string[] } }> }
      | undefined;

    return (answer?.responses ?? []).flatMap((entry) => entry.response?.selectedOptionIds ?? []);
  }
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
      <ol class="ui:space-y-6">
        {#each data.paper?.questions ?? [] as question (question.questionId)}
          {@const chosen = chosenOptionIds(question.questionId)}
          {@const trail = trailByQuestion.get(question.questionId) ?? []}
          <li class="ui:border-border ui:space-y-3 ui:rounded-md ui:border ui:p-4">
            <p class="ui:font-medium">{question.order}</p>

            {#if chosen.length > 0}
              <ul class="ui:space-y-1 ui:text-sm">
                {#each chosen as optionId (optionId)}
                  <li
                    class={isCorrectOption(question.questionId, optionId) ? 'ui:text-green-700' : 'ui:text-destructive'}
                  >
                    {optionId}
                    {isCorrectOption(question.questionId, optionId) ? '✓' : '✗'}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.results.not_answered')}</p>
            {/if}

            {#if trail.length > 1}
              <!-- Settles a dispute about a result, and shows a paper answered all at once. -->
              <p class="ui:text-muted-foreground ui:text-xs">
                {$t('exam.results.changed_answer', { count: String(trail.length - 1) })}
              </p>
            {/if}

            <div class="ui:flex ui:flex-wrap ui:items-end ui:gap-2">
              <div class="ui:w-24">
                <label class="ui:text-muted-foreground ui:text-xs" for={`mark-${question.questionId}`}
                  >{$t('exam.results.score_column')}</label
                >
                <Input
                  id={`mark-${question.questionId}`}
                  inputmode="decimal"
                  value={marks[question.questionId]?.score ?? ''}
                  oninput={(event: Event) =>
                    (edited[question.questionId] = {
                      score: (event.currentTarget as HTMLInputElement).value,
                      comment: marks[question.questionId]?.comment ?? ''
                    })}
                />
              </div>
              <div class="ui:min-w-48 ui:flex-1">
                <label class="ui:text-muted-foreground ui:text-xs" for={`comment-${question.questionId}`}
                  >{$t('exam.results.comment_column')}</label
                >
                <Textarea
                  id={`comment-${question.questionId}`}
                  rows={2}
                  value={marks[question.questionId]?.comment ?? ''}
                  oninput={(event: Event) =>
                    (edited[question.questionId] = {
                      score: marks[question.questionId]?.score ?? '',
                      comment: (event.currentTarget as HTMLTextAreaElement).value
                    })}
                />
              </div>
              <Button
                size="sm"
                disabled={savingQuestionId === question.questionId}
                onclick={() => saveMark(question.questionId)}
              >
                {$t('exam.results.save_mark')}
              </Button>
            </div>
          </li>
        {/each}
      </ol>
    {/snippet}
  </Page.Body>
</Page.Root>
