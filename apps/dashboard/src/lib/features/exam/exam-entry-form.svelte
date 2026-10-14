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
    attemptsUsed = false,
    resumeOffer = undefined,
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
    /** Set when the candidate says the device belongs to somebody who has already sat. */
    attemptsUsed?: boolean;
    /**
     * The offer to carry on with a paper this device already has open, drawn above the
     * fields. It lives in the same card because it is the same decision: this paper, or a
     * new one. The form never knows what is inside it.
     */
    resumeOffer?: import('svelte').Snippet;
    onstart: (details: {
      displayName: string;
      className: string;
      candidateNumber: string;
      nickname: string;
      password: string;
      sameDeviceDifferentPerson: boolean;
    }) => void;
  } = $props();

  let displayName = $state('');
  let className = $state('');
  let candidateNumber = $state('');
  let nickname = $state('');
  let password = $state('');
  let sameDeviceDifferentPerson = $state(false);

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
      nickname: nickname.trim(),
      password,
      sameDeviceDifferentPerson
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

    {#if resumeOffer}
      {@render resumeOffer()}

      <!-- Says plainly that what follows is the other choice, not a second step. -->
      <p class="ui:text-muted-foreground ui:text-center ui:text-xs">{$t('exam.resume.or_new')}</p>
    {/if}

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

    <!--
      Always offered, never required. Two candidates in one class sharing a name is
      ordinary, and where the school issues no candidate numbers this is the only thing
      that tells their two rows apart on the teacher's list.
    -->
    <Field.Field>
      <Field.Label for="exam-nickname">{$t('exam.entry.nickname')}</Field.Label>
      <Field.Content>
        <Input
          id="exam-nickname"
          bind:value={nickname}
          maxlength={120}
          disabled={starting}
          placeholder={$t('exam.entry.nickname_placeholder')}
        />
        <Field.Description>{$t('exam.entry.nickname_help')}</Field.Description>
      </Field.Content>
    </Field.Field>

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
    <p class="ui:text-muted-foreground ui:text-xs">
      {$t('exam.entry.device_notice')}
    </p>

    {#if error}
      <p class="ui:text-destructive ui:text-sm" role="alert">{error}</p>
    {/if}

    <!--
      The one case the per-device count cannot see: two candidates taking turns on one
      phone. The second is told they have used their attempts, which is true of the device
      and false of them, and without a way past it they simply cannot sit the paper.
      Believing them costs nothing — anybody minded to defeat a cookie can clear it without
      being offered a button — and refusing them would stop only the honest.
    -->
    {#if attemptsUsed}
      <label class="ui:border-border ui:flex ui:items-start ui:gap-2 ui:rounded-md ui:border ui:p-3 ui:text-sm">
        <input type="checkbox" bind:checked={sameDeviceDifferentPerson} class="ui:mt-0.5" />
        <span>{$t('exam.entry.shared_device')}</span>
      </label>
    {/if}

    <Button type="submit" class="ui:min-h-11 ui:w-full" disabled={missing || starting}>
      {starting ? $t('exam.entry.starting') : $t('exam.entry.start')}
    </Button>
  </div>
</AuthUI>
