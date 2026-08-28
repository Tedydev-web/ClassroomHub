<script lang="ts">
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
  import { Button } from '@cio/ui/base/button';

  import { t } from '$lib/utils/functions/translations';
  import { resumeOwnerDetails, resumeOwnerName, resumeStartedAtLabel, type ResumeOwner } from './exam-resume-owner';

  /**
   * The offer to carry on with the paper this device already has open.
   *
   * It is an offer and never an action taken on the candidate's behalf. The page used to
   * resume silently, which is right for the person refreshing their own paper and wrong for
   * the second person to pick up a shared phone — and only the human looking at the screen
   * can tell those two apart.
   *
   * So it names the holder and then waits. There is deliberately no "this is not mine"
   * button to decline with: declining is simply filling in the form underneath, which is
   * already there. A candidate cannot lose their paper to a mistap on a control that does
   * not exist, and the offer stays put no matter what else they touch.
   */
  let {
    owner,
    secondsRemaining = null,
    continuing = false,
    error = null,
    oncontinue
  }: {
    owner: ResumeOwner;
    secondsRemaining?: number | null;
    continuing?: boolean;
    error?: string | null;
    oncontinue: () => void;
  } = $props();

  const name = $derived(resumeOwnerName(owner));
  const details = $derived(resumeOwnerDetails(owner));
  const startedAt = $derived(resumeStartedAtLabel(owner.startedAt));

  const minutesLeft = $derived(secondsRemaining && secondsRemaining > 0 ? Math.ceil(secondsRemaining / 60) : null);
</script>

<div class="ui:border-primary/40 ui:bg-primary/5 ui:space-y-3 ui:rounded-lg ui:border ui:p-4">
  <p class="ui:flex ui:items-center ui:gap-2 ui:text-sm ui:font-semibold">
    <RotateCcwIcon size={16} aria-hidden="true" />
    {$t('exam.resume.heading')}
  </p>

  <div class="ui:space-y-0.5">
    {#if name}
      <p class="ui:text-base ui:font-semibold">{name}</p>
    {/if}

    <!--
      Every identifying field is optional per exam, so the start time is what remains when
      the paper asked for nothing. It names nobody, which is the point: it is still
      something the holder knows about their own morning.
    -->
    <p class="ui:text-muted-foreground ui:text-sm">
      {#if details.length > 0}{details.join(' · ')}{/if}
      {#if details.length > 0 && startedAt}&nbsp;·&nbsp;{/if}
      {#if startedAt}{$t('exam.resume.started_at', { time: startedAt })}{/if}
    </p>

    {#if minutesLeft}
      <p class="ui:text-muted-foreground ui:text-sm">
        {$t('exam.resume.remaining', { minutes: String(minutesLeft) })}
      </p>
    {/if}
  </div>

  {#if error}
    <p class="ui:text-destructive ui:text-sm">{error}</p>
  {/if}

  <Button type="button" class="ui:min-h-11 ui:w-full" disabled={continuing} onclick={oncontinue}>
    {continuing ? $t('exam.resume.continuing') : $t('exam.resume.continue')}
  </Button>

  <!--
    Said in words rather than left to be inferred from a button that is not there. A
    candidate who is not the holder needs to know the form below is theirs to use.
  -->
  <p class="ui:text-muted-foreground ui:text-xs">
    {$t('exam.resume.not_yours')}
  </p>
</div>
