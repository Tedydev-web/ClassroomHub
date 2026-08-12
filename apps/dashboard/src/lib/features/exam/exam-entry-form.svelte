<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Input } from '@cio/ui/base/input';
  import { Label } from '@cio/ui/base/label';

  /**
   * What a sitter fills in before the clock starts. Only the fields the exam asks for
   * appear, and everything is checked before starting — being told a password is wrong
   * after the clock has started would be its own small injustice.
   */
  let {
    title,
    requiresName = true,
    requiresClass = false,
    requiresCandidateNumber = false,
    requiresPassword = false,
    workingMinutes = null,
    starting = false,
    error = null,
    onstart
  }: {
    title: string;
    requiresName?: boolean;
    requiresClass?: boolean;
    requiresCandidateNumber?: boolean;
    requiresPassword?: boolean;
    workingMinutes?: number | null;
    starting?: boolean;
    error?: string | null;
    onstart: (details: { displayName: string; className: string; candidateNumber: string; password: string }) => void;
  } = $props();

  let displayName = $state('');
  let className = $state('');
  let candidateNumber = $state('');
  let password = $state('');

  const missing = $derived(
    (requiresName && displayName.trim().length === 0) ||
      (requiresClass && className.trim().length === 0) ||
      (requiresCandidateNumber && candidateNumber.trim().length === 0) ||
      (requiresPassword && password.length === 0)
  );

  function start() {
    if (missing || starting) return;

    onstart({
      displayName: displayName.trim(),
      className: className.trim(),
      candidateNumber: candidateNumber.trim(),
      password
    });
  }
</script>

<div class="ui:mx-auto ui:w-full ui:max-w-md ui:space-y-6 ui:px-4 ui:py-10">
  <div class="ui:space-y-2">
    <h1 class="ui:text-2xl ui:font-semibold">{title}</h1>
    {#if workingMinutes}
      <p class="ui:text-muted-foreground ui:text-sm">
        {$t('exam.entry.working_time', { minutes: String(workingMinutes) })}
      </p>
    {/if}
  </div>

  <div class="ui:space-y-4">
    {#if requiresName}
      <div class="ui:space-y-2">
        <Label for="exam-name">{$t('exam.entry.full_name')}</Label>
        <Input id="exam-name" bind:value={displayName} autocomplete="name" maxlength={120} />
      </div>
    {/if}

    {#if requiresClass}
      <div class="ui:space-y-2">
        <Label for="exam-class">{$t('exam.entry.class_name')}</Label>
        <Input id="exam-class" bind:value={className} maxlength={120} />
      </div>
    {/if}

    {#if requiresCandidateNumber}
      <div class="ui:space-y-2">
        <Label for="exam-candidate">{$t('exam.entry.candidate_number')}</Label>
        <Input id="exam-candidate" bind:value={candidateNumber} maxlength={120} />
      </div>
    {/if}

    {#if requiresPassword}
      <div class="ui:space-y-2">
        <Label for="exam-password">{$t('exam.entry.password')}</Label>
        <Input id="exam-password" type="password" bind:value={password} maxlength={200} />
      </div>
    {/if}
  </div>

  <!--
    Said before they start rather than discovered afterwards. Azota states the same
    limitation of sitting without an account: the result is not theirs to come back to.
  -->
  <p class="ui:text-muted-foreground ui:text-xs">
    {$t('exam.entry.no_history_notice')}
  </p>

  {#if error}
    <p class="ui:text-destructive ui:text-sm" role="alert">{error}</p>
  {/if}

  <Button class="ui:min-h-11 ui:w-full" disabled={missing || starting} onclick={start}>
    {starting ? $t('exam.entry.starting') : $t('exam.entry.start')}
  </Button>
</div>
