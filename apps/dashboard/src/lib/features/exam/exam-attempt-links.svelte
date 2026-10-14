<script lang="ts">
  import { locale, t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import * as Popover from '@cio/ui/base/popover';
  import type { ExamAttemptLinkage } from '$features/exam/exam-result-row';

  let { linkage, onopen }: { linkage: ExamAttemptLinkage; onopen: (attemptId: string) => void } = $props();

  const strongest = $derived(linkage.links[0] ?? null);
  const retake = $derived(linkage.startedAfterSubmitOf);

  function clockOf(value: string | null): string {
    if (!value) return '';

    return new Date(value).toLocaleString($locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function nameOf(value: string | null): string {
    return value?.trim() || '—';
  }
</script>

{#if strongest}
  <Popover.Root>
    <Popover.Trigger class="ui:ml-1 ui:align-middle">
      {#if retake}
        <Badge variant="destructive">
          {$t('exam.results.retake_after', { minutes: String(retake.minutes), name: nameOf(retake.displayName) })}
        </Badge>
      {:else}
        <Badge variant={strongest.signal === 'network' ? 'secondary' : 'default'}>
          {$t(`exam.results.link_${strongest.signal}`, { name: nameOf(strongest.displayName) })}{linkage.links.length >
          1
            ? ` +${linkage.links.length - 1}`
            : ''}
        </Badge>
      {/if}
    </Popover.Trigger>
    <Popover.Content align="start" class="ui:w-96 ui:space-y-3 ui:p-3">
      <p class="ui:text-sm ui:font-medium">{$t('exam.results.links_heading')}</p>
      <ul class="ui:space-y-2">
        {#each linkage.links as link (link.attemptId)}
          <li class="ui:flex ui:items-start ui:justify-between ui:gap-3">
            <div class="ui:min-w-0">
              <p class="ui:truncate ui:text-sm ui:font-medium">{nameOf(link.displayName)}</p>
              <p class="ui:text-muted-foreground ui:text-xs ui:tabular-nums">
                {$t(`exam.results.signal_${link.signal}`)} · {clockOf(link.startedAt)}{link.submittedAt
                  ? ` → ${clockOf(link.submittedAt)}`
                  : ''}
              </p>
            </div>
            <Button size="sm" variant="ghost" onclick={() => onopen(link.attemptId)}>
              {$t('exam.results.open_attempt')}
            </Button>
          </li>
        {/each}
      </ul>
      <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.results.links_note')}</p>
    </Popover.Content>
  </Popover.Root>
{/if}
