<script lang="ts">
  import EyeOffIcon from '@lucide/svelte/icons/eye-off';
  import LogInIcon from '@lucide/svelte/icons/log-in';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import { Badge } from '@cio/ui/base/badge';
  import * as Alert from '@cio/ui/base/alert';
  import * as Card from '@cio/ui/base/card';
  import * as Collapsible from '@cio/ui/base/collapsible';
  import { Button } from '@cio/ui/base/button';

  import { locale, t } from '$lib/utils/functions/translations';
  import { buildAttemptTimeline, type AnswerLogEntry } from './attempt-timeline';
  import type { ActivityEvent } from './exam-activity';

  /**
   * What the paper observed while this candidate sat it.
   *
   * It reports and does not conclude, and the panel says so in its own words rather than
   * leaving a teacher to infer it from a number. There is no score here, no flag, no
   * colour that means guilt: a phone locking its screen produces the same entry as an
   * answer being looked up, and the panel that pretended otherwise would be read as proof.
   *
   * The timeline is the part worth having. A count says how often somebody left; the
   * timeline says what they did in the half minute after they came back, which is a
   * different question and a more answerable one.
   */
  let {
    activityLog,
    answerLog
  }: {
    activityLog: ActivityEvent[] | null | undefined;
    answerLog: AnswerLogEntry[] | null | undefined;
  } = $props();

  const timeline = $derived(buildAttemptTimeline(activityLog, answerLog));

  const clock = $derived(
    new Intl.DateTimeFormat($locale ?? 'vi', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );

  function seconds(value: number): string {
    if (value < 60) return $t('exam.activity.seconds', { count: String(value) });

    return $t('exam.activity.minutes', { count: String(Math.round(value / 60)) });
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title class="ui:text-base">{$t('exam.activity.title')}</Card.Title>
    <Card.Description>{$t('exam.activity.help')}</Card.Description>
  </Card.Header>

  <Card.Content class="ui:space-y-4">
    {#if timeline.focus.leaves === 0}
      <p class="ui:text-muted-foreground ui:text-sm">{$t('exam.activity.never_left')}</p>
    {:else}
      <div class="ui:flex ui:flex-wrap ui:gap-2">
        <Badge variant="secondary">
          {$t('exam.activity.leaves', { count: String(timeline.focus.leaves) })}
        </Badge>
        <Badge variant="outline">
          {$t('exam.activity.total_away', { duration: seconds(timeline.focus.totalAwaySeconds) })}
        </Badge>
        <Badge variant="outline">
          {$t('exam.activity.longest_away', { duration: seconds(timeline.focus.longestAwaySeconds) })}
        </Badge>
        {#if timeline.focus.endedAway}
          <Badge variant="outline">{$t('exam.activity.ended_away')}</Badge>
        {/if}
      </div>

      <!--
        Said next to the numbers rather than in a footnote, because the numbers are what
        somebody will quote later.
      -->
      <Alert.Root>
        <Alert.Description class="ui:text-xs">{$t('exam.activity.not_proof')}</Alert.Description>
      </Alert.Root>

      <Collapsible.Root>
        <Collapsible.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm">{$t('exam.activity.show_timeline')}</Button>
          {/snippet}
        </Collapsible.Trigger>

        <Collapsible.Content>
          <ol class="ui:mt-3 ui:space-y-1.5">
            {#each timeline.entries as entry, index (index)}
              <li class="ui:flex ui:items-start ui:gap-2 ui:text-sm">
                <span class="ui:text-muted-foreground ui:tabular-nums ui:shrink-0">
                  {clock.format(new Date(entry.at))}
                </span>

                {#if entry.kind === 'left'}
                  <EyeOffIcon size={14} class="ui:mt-1 ui:shrink-0" aria-hidden="true" />
                  <span>{$t('exam.activity.entry_left')}</span>
                {:else if entry.kind === 'returned'}
                  <LogInIcon size={14} class="ui:mt-1 ui:shrink-0" aria-hidden="true" />
                  <span>
                    {entry.awaySeconds === null
                      ? $t('exam.activity.entry_returned')
                      : $t('exam.activity.entry_returned_after', { duration: seconds(entry.awaySeconds) })}
                  </span>
                {:else}
                  <PencilIcon size={14} class="ui:text-muted-foreground ui:mt-1 ui:shrink-0" aria-hidden="true" />
                  <span class="ui:text-muted-foreground">
                    {$t('exam.activity.entry_answered', { question: String(entry.questionId) })}
                  </span>
                {/if}
              </li>
            {/each}
          </ol>
        </Collapsible.Content>
      </Collapsible.Root>
    {/if}
  </Card.Content>
</Card.Root>
