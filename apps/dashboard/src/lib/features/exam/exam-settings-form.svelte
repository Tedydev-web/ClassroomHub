<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import { Input } from '@cio/ui/base/input';
  import { Label } from '@cio/ui/base/label';
  import * as RadioGroup from '@cio/ui/base/radio-group';
  import * as Select from '@cio/ui/base/select';

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
  let {
    submitting = false,
    onsubmit
  }: {
    submitting?: boolean;
    onsubmit: (settings: Record<string, unknown>) => void;
  } = $props();

  let title = $state('');
  let mode = $state<'public' | 'private'>('public');
  let workingMinutes = $state('');
  let opensAt = $state('');
  let closesAt = $state('');
  let maxAttempts = $state('1');
  let requiresName = $state(true);
  let requiresClass = $state(true);
  let requiresCandidateNumber = $state(false);
  let scoreVisibility = $state<'never' | 'on_submit' | 'after_everyone' | 'above_threshold'>('never');
  let answerVisibility = $state<'never' | 'on_submit' | 'after_everyone' | 'above_threshold'>('never');

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
      [$t('exam.settings.answer_visibility'), answerVisibility]
    ] as const) {
      if (value === 'after_everyone' && (!closesAt || workingMinutes.trim().length === 0)) {
        found.push($t('exam.settings.after_everyone_needs_times', { label }));
      }
    }

    if (answerVisibility === 'on_submit' && maxAttempts !== '1') {
      found.push($t('exam.settings.on_submit_needs_single_attempt'));
    }

    if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) {
      found.push($t('exam.settings.opens_before_closes'));
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
      closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      maxAttempts: maxAttempts.trim() ? Number(maxAttempts) : null,
      requiresName,
      requiresClass,
      requiresCandidateNumber,
      scoreVisibility,
      answerVisibility,
      commentVisibility: 'never',
      revealThreshold: null
    });
  }
</script>

<div class="ui:space-y-6">
  <div class="ui:space-y-2">
    <Label for="exam-title">{$t('exam.settings.title')}</Label>
    <Input id="exam-title" bind:value={title} maxlength={300} />
  </div>

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

  <div class="ui:grid ui:gap-4 ui:sm:grid-cols-2">
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
        placeholder={$t('exam.settings.leave_empty_unlimited')}
      />
    </div>
    <div class="ui:space-y-2">
      <Label for="exam-opens">{$t('exam.settings.opens_at')}</Label>
      <Input id="exam-opens" type="datetime-local" bind:value={opensAt} />
    </div>
    <div class="ui:space-y-2">
      <Label for="exam-closes">{$t('exam.settings.closes_at')}</Label>
      <Input id="exam-closes" type="datetime-local" bind:value={closesAt} />
    </div>
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

  <div class="ui:grid ui:gap-4 ui:sm:grid-cols-2">
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
  </div>

  {#if issues.length > 0}
    <ul class="ui:text-destructive ui:space-y-1 ui:text-sm" role="alert">
      {#each issues as issue (issue)}
        <li>{issue}</li>
      {/each}
    </ul>
  {/if}

  <Button class="ui:min-h-11" disabled={issues.length > 0 || submitting} onclick={save}>
    {submitting ? $t('exam.settings.saving') : $t('exam.settings.save')}
  </Button>
</div>
