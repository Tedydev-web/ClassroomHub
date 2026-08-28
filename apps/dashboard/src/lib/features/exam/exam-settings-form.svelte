<script lang="ts">
  import { locale, t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import { Input } from '@cio/ui/base/input';
  import { Label } from '@cio/ui/base/label';
  import * as RadioGroup from '@cio/ui/base/radio-group';
  import * as Select from '@cio/ui/base/select';
  import * as Card from '@cio/ui/base/card';
  import * as Alert from '@cio/ui/base/alert';

  import { closingTimeAfterDays } from './exam-closing-time';

  /**
   * Configuring an exam, using the vocabulary Vietnamese teachers already read.
   *
   * Two combinations are refused here rather than saved and left to disappoint. Showing
   * the paper once everyone has finished needs both a closing time and a working time,
   * because the release moment is one plus the other; without them the setting silently
   * means never. And showing the answers on submit alongside more than one permitted
   * attempt is not a setting at all — a sitter submits, reads the key, clears their cookie
   * and sits again with full marks.
   *
   * The server refuses the same combinations. This only says so earlier.
   */
  type Reveal = 'never' | 'on_submit' | 'after_everyone' | 'above_threshold';

  /** An exam already stored, when this form is editing one rather than creating one. */
  type ExamSettingsInitial = {
    title: string;
    mode: 'public' | 'private';
    workingSeconds: number | null;
    opensAt: string | null;
    closesAt: string | null;
    maxAttempts: number | null;
    requiresName: boolean;
    requiresClass: boolean;
    requiresCandidateNumber: boolean;
    scoreVisibility: Reveal;
    answerVisibility: Reveal;
    commentVisibility: Reveal;
    revealThreshold: string | null;
    /** Whether one is set. The password itself never comes back from the server. */
    hasPassword: boolean;
  };

  let {
    submitting = false,
    initial,
    submitLabel,
    onsubmit
  }: {
    submitting?: boolean;
    initial?: ExamSettingsInitial;
    submitLabel?: string;
    onsubmit: (settings: Record<string, unknown>) => void;
  } = $props();

  /**
   * The stored value formatted for `datetime-local`, which reads neither an ISO string
   * with a zone nor a trailing `Z`. Local time is also what a teacher typed in the first
   * place, so this is the value they expect to see again.
   */
  function toLocalInput(value: string | null | undefined): string {
    if (!value) return '';

    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return '';

    const pad = (part: number) => String(part).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }

  // Seeded once. The exam being edited is loaded on the server before this mounts, so
  // there is nothing later to re-seed from, and re-seeding would discard what the teacher
  // has typed.
  let title = $state(initial?.title ?? '');
  let mode = $state<'public' | 'private'>(initial?.mode ?? 'public');
  let workingMinutes = $state(initial?.workingSeconds ? String(Math.round(initial.workingSeconds / 60)) : '');
  let opensAt = $state(toLocalInput(initial?.opensAt));
  let closesAt = $state(toLocalInput(initial?.closesAt));
  let maxAttempts = $state(initial?.maxAttempts === null ? '' : String(initial?.maxAttempts ?? 1));
  let requiresName = $state(initial?.requiresName ?? true);
  let requiresClass = $state(initial?.requiresClass ?? true);
  let requiresCandidateNumber = $state(initial?.requiresCandidateNumber ?? false);
  let scoreVisibility = $state<Reveal>(initial?.scoreVisibility ?? 'never');
  let answerVisibility = $state<Reveal>(initial?.answerVisibility ?? 'never');

  let commentVisibility = $state<Reveal>(initial?.commentVisibility ?? 'never');

  // Stored as the fraction the grader compares against — `score / total` — and typed as
  // the percentage a teacher actually says out loud.
  // The stored password is never readable, so editing an exam that has one starts from
  // "leave it alone" and only sends anything once the teacher says otherwise. Without this
  // the field would arrive empty and saving a changed title would clear the password.
  let password = $state('');
  let passwordTouched = $state(false);

  /**
   * Two ways to say the same closing time. A teacher who knows "it runs for three days"
   * should not have to work out which date that lands on, especially across the end of a
   * month — but one who knows the exact moment still types it, so this is an extra way in
   * rather than a replacement. Only `closesAt` is ever stored.
   */
  let closeMode = $state<'at' | 'after'>('at');
  let closeAfterDays = $state('');

  const closesAtIso = $derived.by(() => {
    if (closeMode === 'after')
      return opensAt ? closingTimeAfterDays(new Date(opensAt).toISOString(), Number(closeAfterDays)) : null;

    return closesAt ? new Date(closesAt).toISOString() : null;
  });

  /** The computed date, shown back so the teacher can check it before saving. */
  const closesAtPreview = $derived(
    closeMode === 'after' && closesAtIso ? new Date(closesAtIso).toLocaleString($locale ?? 'vi') : ''
  );

  let thresholdPercent = $state(
    initial?.revealThreshold ? String(Math.round(Number(initial.revealThreshold) * 100)) : ''
  );

  const needsThreshold = $derived([scoreVisibility, answerVisibility, commentVisibility].includes('above_threshold'));

  const REVEAL_OPTIONS = [
    { value: 'never', label: $t('exam.settings.reveal_never') },
    { value: 'on_submit', label: $t('exam.settings.reveal_on_submit') },
    { value: 'after_everyone', label: $t('exam.settings.reveal_after_everyone') },
    { value: 'above_threshold', label: $t('exam.settings.reveal_above_threshold') }
  ] as const;

  const issues = $derived.by(() => {
    const found: string[] = [];

    if (title.trim().length === 0) found.push($t('exam.settings.needs_title'));

    for (const [label, value] of [
      [$t('exam.settings.score_visibility'), scoreVisibility],
      [$t('exam.settings.answer_visibility'), answerVisibility],
      [$t('exam.settings.comment_visibility'), commentVisibility]
    ] as const) {
      if (value === 'after_everyone' && (!closesAtIso || workingMinutes.trim().length === 0)) {
        found.push($t('exam.settings.after_everyone_needs_times', { label }));
      }
    }

    // The server refuses `above_threshold` without a threshold. Saying so here is what
    // stops a teacher choosing it, being refused, and having nowhere to go: until this
    // field existed the setting could be picked and never saved.
    if (needsThreshold) {
      const percent = Number(thresholdPercent);
      if (!thresholdPercent.trim() || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
        found.push($t('exam.settings.threshold_needs_percent'));
      }
    }

    if (answerVisibility === 'on_submit' && maxAttempts !== '1') {
      found.push($t('exam.settings.on_submit_needs_single_attempt'));
    }

    if (opensAt && closesAtIso && new Date(opensAt) >= new Date(closesAtIso)) {
      found.push($t('exam.settings.opens_before_closes'));
    }

    if (closeMode === 'after') {
      const days = Number(closeAfterDays);

      if (!opensAt) {
        found.push($t('exam.settings.after_days_needs_open'));
      } else if (!closeAfterDays.trim() || !Number.isFinite(days) || days <= 0) {
        found.push($t('exam.settings.after_days_needs_number'));
      }
    }

    return found;
  });

  function save() {
    if (issues.length > 0 || submitting) return;

    onsubmit({
      title: title.trim(),
      mode,
      workingSeconds: workingMinutes.trim() ? Math.round(Number(workingMinutes) * 60) : null,
      opensAt: opensAt ? new Date(opensAt).toISOString() : null,
      closesAt: closesAtIso,
      maxAttempts: maxAttempts.trim() ? Number(maxAttempts) : null,
      requiresName,
      requiresClass,
      requiresCandidateNumber,
      scoreVisibility,
      answerVisibility,
      commentVisibility,
      revealThreshold: needsThreshold ? String(Number(thresholdPercent) / 100) : null,
      // Omitted entirely unless it was touched, which is what tells the server to keep the
      // password it already has. An empty box that was touched removes it.
      ...(initial && !passwordTouched ? {} : { password: password.trim() || null })
    });
  }
</script>

<div class="ui:space-y-6">
  <!--
    Four sections, because these settings are not one list. A teacher setting up a first
    exam reads them as four decisions — what the paper is, who may sit it, when, and what
    the candidate learns afterwards — and the flat run of eight field groups gave them no
    map for any of it.
  -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="ui:text-base">{$t('exam.settings.section_paper')}</Card.Title>
    </Card.Header>
    <Card.Content class="ui:space-y-2">
      <Label for="exam-title">{$t('exam.settings.title')}</Label>
      <Input id="exam-title" bind:value={title} maxlength={300} />
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="ui:text-base">{$t('exam.settings.section_access')}</Card.Title>
      <Card.Description>{$t('exam.settings.access_help')}</Card.Description>
    </Card.Header>
    <Card.Content class="ui:space-y-6">
      <fieldset class="ui:space-y-2">
        <legend class="ui:text-sm ui:font-medium">{$t('exam.settings.who_can_sit')}</legend>
        <RadioGroup.Root bind:value={mode} class="ui:space-y-2">
          <div class="ui:flex ui:items-center ui:gap-2">
            <RadioGroup.Item value="public" id="exam-mode-public" />
            <Label for="exam-mode-public" class="ui:font-normal">{$t('exam.settings.anyone_with_link')}</Label>
          </div>
          <div class="ui:flex ui:items-center ui:gap-2">
            <RadioGroup.Item value="private" id="exam-mode-private" />
            <Label for="exam-mode-private" class="ui:font-normal">{$t('exam.settings.signed_in_only')}</Label>
          </div>
        </RadioGroup.Root>
      </fieldset>

      <div class="ui:space-y-2">
        <Label for="exam-password">{$t('exam.settings.password')}</Label>
        <Input
          id="exam-password"
          type="text"
          autocomplete="off"
          bind:value={password}
          oninput={() => (passwordTouched = true)}
          placeholder={initial?.hasPassword
            ? $t('exam.settings.password_set_placeholder')
            : $t('exam.settings.password_placeholder')}
        />
        <p class="ui:text-muted-foreground ui:text-xs">
          {#if initial?.hasPassword && !passwordTouched}
            {$t('exam.settings.password_kept')}
          {:else if initial?.hasPassword}
            {$t('exam.settings.password_clear_hint')}
          {:else}
            {$t('exam.settings.password_help')}
          {/if}
        </p>
      </div>

      <fieldset class="ui:space-y-2">
        <legend class="ui:text-sm ui:font-medium">{$t('exam.settings.declared_fields')}</legend>
        <div class="ui:flex ui:items-center ui:gap-2">
          <Checkbox id="exam-requires-name" bind:checked={requiresName} />
          <Label for="exam-requires-name" class="ui:font-normal">{$t('exam.entry.full_name')}</Label>
        </div>
        <div class="ui:flex ui:items-center ui:gap-2">
          <Checkbox id="exam-requires-class" bind:checked={requiresClass} />
          <Label for="exam-requires-class" class="ui:font-normal">{$t('exam.entry.class_name')}</Label>
        </div>
        <div class="ui:flex ui:items-center ui:gap-2">
          <Checkbox id="exam-requires-candidate" bind:checked={requiresCandidateNumber} />
          <Label for="exam-requires-candidate" class="ui:font-normal">{$t('exam.entry.candidate_number')}</Label>
        </div>
      </fieldset>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="ui:text-base">{$t('exam.settings.section_timing')}</Card.Title>
      <Card.Description>{$t('exam.settings.timing_help')}</Card.Description>
    </Card.Header>
    <Card.Content class="ui:grid ui:gap-4 ui:sm:grid-cols-2">
      <div class="ui:space-y-2">
        <Label for="exam-minutes">{$t('exam.settings.working_minutes')}</Label>
        <Input
          id="exam-minutes"
          inputmode="numeric"
          bind:value={workingMinutes}
          placeholder={$t('exam.settings.leave_empty_unlimited')}
        />
      </div>
      <div class="ui:space-y-2">
        <Label for="exam-attempts">{$t('exam.settings.max_attempts')}</Label>
        <Input
          id="exam-attempts"
          inputmode="numeric"
          bind:value={maxAttempts}
          placeholder={$t('exam.settings.unlimited_attempts')}
        />
      </div>
      <div class="ui:space-y-2">
        <Label for="exam-opens">{$t('exam.settings.opens_at')}</Label>
        <Input id="exam-opens" type="datetime-local" bind:value={opensAt} />
      </div>
      <div class="ui:space-y-2">
        <fieldset class="ui:space-y-2">
          <legend class="ui:text-sm ui:font-medium">{$t('exam.settings.closes_at')}</legend>
          <RadioGroup.Root bind:value={closeMode} class="ui:flex ui:flex-wrap ui:gap-4">
            <div class="ui:flex ui:items-center ui:gap-2">
              <RadioGroup.Item value="at" id="exam-close-at" />
              <Label for="exam-close-at" class="ui:font-normal">{$t('exam.settings.close_at_moment')}</Label>
            </div>
            <div class="ui:flex ui:items-center ui:gap-2">
              <RadioGroup.Item value="after" id="exam-close-after" />
              <Label for="exam-close-after" class="ui:font-normal">{$t('exam.settings.close_after_days')}</Label>
            </div>
          </RadioGroup.Root>
        </fieldset>

        {#if closeMode === 'at'}
          <Input id="exam-closes" type="datetime-local" bind:value={closesAt} />
        {:else}
          <Input id="exam-close-days" inputmode="numeric" bind:value={closeAfterDays} placeholder="3" />
          <p class="ui:text-muted-foreground ui:text-xs">
            {#if closesAtPreview}
              {$t('exam.settings.closes_on', { at: closesAtPreview })}
            {:else}
              {$t('exam.settings.after_days_help')}
            {/if}
          </p>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="ui:text-base">{$t('exam.settings.section_reveal')}</Card.Title>
      <Card.Description>{$t('exam.settings.reveal_help')}</Card.Description>
    </Card.Header>
    <Card.Content class="ui:grid ui:gap-4 ui:sm:grid-cols-2">
      <div class="ui:space-y-2">
        <Label for="exam-score-visibility">{$t('exam.settings.score_visibility')}</Label>
        <Select.Root type="single" bind:value={scoreVisibility}>
          <Select.Trigger id="exam-score-visibility" class="ui:w-full">
            {REVEAL_OPTIONS.find((option) => option.value === scoreVisibility)?.label ?? ''}
          </Select.Trigger>
          <Select.Content>
            {#each REVEAL_OPTIONS as option (option.value)}
              <Select.Item value={option.value}>{option.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="ui:space-y-2">
        <Label for="exam-answer-visibility">{$t('exam.settings.answer_visibility')}</Label>
        <Select.Root type="single" bind:value={answerVisibility}>
          <Select.Trigger id="exam-answer-visibility" class="ui:w-full">
            {REVEAL_OPTIONS.find((option) => option.value === answerVisibility)?.label ?? ''}
          </Select.Trigger>
          <Select.Content>
            {#each REVEAL_OPTIONS as option (option.value)}
              <Select.Item value={option.value}>{option.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="ui:space-y-2">
        <Label for="exam-comment-visibility">{$t('exam.settings.comment_visibility')}</Label>
        <Select.Root type="single" bind:value={commentVisibility}>
          <Select.Trigger id="exam-comment-visibility" class="ui:w-full">
            {REVEAL_OPTIONS.find((option) => option.value === commentVisibility)?.label ?? ''}
          </Select.Trigger>
          <Select.Content>
            {#each REVEAL_OPTIONS as option (option.value)}
              <Select.Item value={option.value}>{option.label}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      {#if needsThreshold}
        <div class="ui:space-y-2">
          <Label for="exam-threshold">{$t('exam.settings.reveal_threshold')}</Label>
          <Input id="exam-threshold" inputmode="numeric" bind:value={thresholdPercent} placeholder="50" />
          <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.settings.threshold_help')}</p>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <!--
    The reasons the save button is disabled, stated where the button is. They used to be a
    bare list at the foot of the form, so a teacher met a dead button first and the
    explanation second.
  -->
  {#if issues.length > 0}
    <Alert.Root variant="destructive" role="alert">
      <Alert.Title>{$t('exam.settings.issues_heading', { count: String(issues.length) })}</Alert.Title>
      <Alert.Description>
        <ul class="ui:list-disc ui:space-y-1 ui:pl-4">
          {#each issues as issue (issue)}
            <li>{issue}</li>
          {/each}
        </ul>
      </Alert.Description>
    </Alert.Root>
  {/if}

  <Button class="ui:min-h-11 ui:w-full sm:w-auto" disabled={issues.length > 0 || submitting} onclick={save}>
    {submitting ? $t('exam.settings.saving') : (submitLabel ?? $t('exam.settings.save'))}
  </Button>
</div>
