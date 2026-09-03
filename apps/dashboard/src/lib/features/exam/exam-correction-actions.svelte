<script lang="ts">
  import type { AnswerKeyQuestion } from '$features/exam/exam-answer-key-question';
  import { t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { Label } from '@cio/ui/base/label';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as RadioGroup from '@cio/ui/base/radio-group';

  /**
   * What a teacher can do about one question's key, drawn beneath the question itself.
   *
   * The paper above is the paper the class read, with the key already marked on the options.
   * Everything here is the part that changes it, kept out of the renderer so the paper stays
   * one drawing used by every screen.
   *
   * Two remedies, because a wrong key has two shapes. Where the right option is simply a
   * different one, the key is replaced. Where the question cannot be answered correctly at
   * all — no option is right, or two are — nobody can be asked to have chosen correctly, so
   * the question is awarded to everyone.
   */

  let {
    question,
    busy = false,
    onfix,
    onaward
  }: {
    question: AnswerKeyQuestion;
    busy?: boolean;
    onfix: (correctedKey: string[]) => void;
    onaward: () => void;
  } = $props();

  let editing = $state(false);
  let draft = $state<string[]>([]);
  let awarding = $state(false);

  function beginEdit() {
    editing = true;
    draft = [...question.effectiveKey];
  }

  function toggle(optionId: string, checked: boolean) {
    draft = checked ? [...draft, optionId] : draft.filter((id) => id !== optionId);
  }

  /** Nothing to save until the teacher has actually chosen something different. */
  const changed = $derived.by(() => {
    if (draft.length === 0) return false;
    if (draft.length !== question.effectiveKey.length) return true;

    const sorted = [...question.effectiveKey].sort();

    return ![...draft].sort().every((id, index) => id === sorted[index]);
  });
</script>

<div class="ui:space-y-3">
  {#if question.corrected || question.awarded}
    <div class="ui:flex ui:flex-wrap ui:gap-2">
      {#if question.corrected}
        <Badge variant="secondary">{$t('exam.corrections.corrected_badge')}</Badge>
      {/if}
      {#if question.awarded}
        <Badge variant="secondary">{$t('exam.corrections.awarded_badge')}</Badge>
      {/if}
    </div>
  {/if}

  <!--
    Said in words, because a question with no key looks exactly like one nobody has marked
    yet: nothing is highlighted above either way. Every candidate is counted wrong on it,
    which is a fact about the paper worth stating where somebody can act on it.
  -->
  {#if question.keyFixable && question.effectiveKey.length === 0}
    <p class="ui:text-destructive ui:text-xs">{$t('exam.corrections.no_key_warning')}</p>
  {/if}

  {#if editing}
    <fieldset class="ui:space-y-2">
      <legend class="ui:text-sm ui:font-medium">{$t('exam.corrections.pick_correct')}</legend>
      {#if question.cardinality === 'single'}
        <!--
          One option, not a free choice of several. A candidate answering this question sent
          exactly one option, and the grader compares the key against what they sent by size
          before it compares by value — so a key naming two would mark every candidate wrong
          on this question. The control that cannot express that key is the honest way to say
          so.
        -->
        <RadioGroup.Root value={draft[0] ?? ''} onValueChange={(value) => (draft = [value])} class="ui:space-y-2">
          {#each question.options as option (option.id)}
            <div class="ui:flex ui:items-start ui:gap-2">
              <RadioGroup.Item value={option.id} id={`key-${question.interactionId}-${option.id}`} />
              <Label for={`key-${question.interactionId}-${option.id}`} class="ui:font-normal">
                <span class="ui:font-medium">{option.label}.</span>
                <SafeHtmlContent content={option.html} />
              </Label>
            </div>
          {/each}
        </RadioGroup.Root>
      {:else}
        {#each question.options as option (option.id)}
          <div class="ui:flex ui:items-start ui:gap-2">
            <Checkbox
              id={`key-${question.interactionId}-${option.id}`}
              checked={draft.includes(option.id)}
              onCheckedChange={(checked) => toggle(option.id, checked === true)}
            />
            <Label for={`key-${question.interactionId}-${option.id}`} class="ui:font-normal">
              <span class="ui:font-medium">{option.label}.</span>
              <SafeHtmlContent content={option.html} />
            </Label>
          </div>
        {/each}
      {/if}
    </fieldset>

    <div class="ui:flex ui:flex-wrap ui:gap-2">
      <Button size="sm" disabled={busy || !changed} onclick={() => onfix(draft)}>
        {busy ? $t('exam.corrections.saving') : $t('exam.corrections.save_key')}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onclick={() => (editing = false)}>
        {$t('exam.corrections.cancel')}
      </Button>
    </div>
  {:else}
    <div class="ui:flex ui:flex-wrap ui:gap-2">
      {#if question.keyFixable && !question.hasSeveralChoiceParts}
        <Button size="sm" variant="outline" disabled={busy} onclick={beginEdit}>
          {$t('exam.corrections.fix_key')}
        </Button>
      {/if}
      <Button size="sm" variant="ghost" disabled={busy || question.awarded} onclick={() => (awarding = true)}>
        {$t('exam.corrections.award')}
      </Button>
    </div>

    {#if question.hasSeveralChoiceParts}
      <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.corrections.several_parts')}</p>
    {:else if !question.keyFixable}
      <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.corrections.not_choice')}</p>
    {/if}
  {/if}
</div>

<Dialog.Root open={awarding} onOpenChange={(open) => (awarding = open)}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{$t('exam.corrections.award')}</Dialog.Title>
      <!--
        An award is recorded against the item, so on a passage it reaches every question in
        it. Naming one number while quietly moving five others would leave a teacher to find
        that out from the results.
      -->
      <Dialog.Description>
        {question.questionsInItem > 1
          ? $t('exam.corrections.award_explainer_group', {
              position: String(question.position),
              count: String(question.questionsInItem - 1)
            })
          : $t('exam.corrections.award_explainer', { position: String(question.position) })}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (awarding = false)}>{$t('exam.corrections.cancel')}</Button>
      <Button
        onclick={() => {
          awarding = false;
          onaward();
        }}
      >
        {$t('exam.corrections.award_confirm')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
