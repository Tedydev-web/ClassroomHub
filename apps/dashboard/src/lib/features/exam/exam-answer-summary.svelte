<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import * as Empty from '@cio/ui/base/empty';

  /**
   * What the class chose, question by question.
   *
   * The marks say who scored what; this says which question the class fell for and what
   * they fell for instead — which is the thing a teacher needs before going through the
   * paper in the room. A question everybody answered correctly does not need the ten
   * minutes; the one where two thirds chose B is the lesson.
   *
   * The exercise's submissions tab has had this shape for a long time. An exam had only the
   * table of marks, so a teacher preparing a correction session had to read forty rows
   * sideways and count in their head.
   */
  type QuestionDistribution = {
    position: number;
    key: string;
    letters: string[];
    counts: Record<string, number>;
    blank: number;
    correct: number;
    answered: number;
  };

  let { questions }: { questions: QuestionDistribution[] } = $props();

  /** The share of the class, as a width. Zero candidates means zero width, not a crash. */
  function share(count: number, answered: number): number {
    return answered > 0 ? Math.round((count / answered) * 100) : 0;
  }
</script>

{#if questions.length === 0}
  <Empty.Root>
    <Empty.Content>
      <Empty.Description>{$t('exam.results.empty')}</Empty.Description>
    </Empty.Content>
  </Empty.Root>
{:else}
  <div class="space-y-3">
    {#each questions as question (question.position)}
      {@const wrong = question.answered - question.correct - question.blank}
      <div class="border-border rounded-lg border p-3">
        <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p class="text-sm font-semibold">
            {$t('exam.results.question_short')}{question.position}
          </p>
          <p class="text-muted-foreground text-xs tabular-nums">
            {$t('exam.results.right_count', { count: String(question.correct), total: String(question.answered) })}
            {#if wrong > 0}
              · {$t('exam.results.wrong_count', { count: String(wrong) })}
            {/if}
            {#if question.blank > 0}
              · {$t('exam.results.blank_count', { count: String(question.blank) })}
            {/if}
          </p>
        </div>

        <div class="space-y-1.5">
          {#each question.letters as letter (letter)}
            {@const count = question.counts[letter] ?? 0}
            {@const isKey = question.key.includes(letter)}
            <div class="flex items-center gap-2">
              <!--
                The key is marked on the letter rather than only on the bar, so a teacher
                scanning down the page can find the right answer without reading the widths.
              -->
              <span
                class={[
                  'w-6 shrink-0 rounded text-center text-xs font-semibold',
                  isKey ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'
                ]}
              >
                {letter}
              </span>

              <div class="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                <div
                  class={['h-full rounded-full', isKey ? 'bg-emerald-500' : 'bg-muted-foreground/40']}
                  style={`width: ${share(count, question.answered)}%`}
                ></div>
              </div>

              <span class="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
                {count} · {share(count, question.answered)}%
              </span>
            </div>
          {/each}

          {#if question.blank > 0}
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground w-6 shrink-0 text-center text-xs">—</span>
              <div class="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                <div
                  class="bg-muted-foreground/25 h-full rounded-full"
                  style={`width: ${share(question.blank, question.answered)}%`}
                ></div>
              </div>
              <span class="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
                {question.blank} · {share(question.blank, question.answered)}%
              </span>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
