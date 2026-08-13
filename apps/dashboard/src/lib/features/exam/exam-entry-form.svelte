<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { AuthUI } from '$features/ui';
  import { Button } from '@cio/ui/base/button';
  import * as Field from '@cio/ui/base/field';
  import { Input } from '@cio/ui/base/input';

  /**
   * Sitting an exam starts the same way signing in does, so it looks the same: the auth
   * shell, with its card, its background and the organisation's own logo. A sitter arrives
   * here from a link with no other context, and a bare form floating on a white page reads
   * like a broken site rather than the school's.
   *
   * `showOnlyContent` keeps the shell but drops what belongs to signing in — the Google
   * button, the welcome copy, the link to register.
   *
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

<AuthUI showOnlyContent showLogo isLoading={starting} handleSubmit={start}>
  <div class="ui:flex ui:flex-col ui:gap-6">
    <div class="ui:space-y-1 ui:text-center">
      <h1 class="ui:text-xl ui:font-semibold">{title}</h1>
      {#if workingMinutes}
        <p class="ui:text-muted-foreground ui:text-sm">
          {$t('exam.entry.working_time', { minutes: String(workingMinutes) })}
        </p>
      {/if}
    </div>

    {#if requiresName}
      <Field.Field>
        <Field.Label for="exam-name">{$t('exam.entry.full_name')}</Field.Label>
        <Field.Content>
          <Input id="exam-name" bind:value={displayName} autocomplete="name" maxlength={120} disabled={starting} />
        </Field.Content>
      </Field.Field>
    {/if}

    {#if requiresClass}
      <Field.Field>
        <Field.Label for="exam-class">{$t('exam.entry.class_name')}</Field.Label>
        <Field.Content>
          <Input id="exam-class" bind:value={className} maxlength={120} disabled={starting} />
        </Field.Content>
      </Field.Field>
    {/if}

    {#if requiresCandidateNumber}
      <Field.Field>
        <Field.Label for="exam-candidate">{$t('exam.entry.candidate_number')}</Field.Label>
        <Field.Content>
          <Input id="exam-candidate" bind:value={candidateNumber} maxlength={120} disabled={starting} />
        </Field.Content>
      </Field.Field>
    {/if}

    {#if requiresPassword}
      <Field.Field>
        <Field.Label for="exam-password">{$t('exam.entry.password')}</Field.Label>
        <Field.Content>
          <Input
            id="exam-password"
            type="password"
            bind:value={password}
            maxlength={200}
            disabled={starting}
            autocomplete="off"
          />
        </Field.Content>
      </Field.Field>
    {/if}

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

    <Button type="submit" class="ui:min-h-11 ui:w-full" disabled={missing || starting}>
      {starting ? $t('exam.entry.starting') : $t('exam.entry.start')}
    </Button>
  </div>
</AuthUI>
