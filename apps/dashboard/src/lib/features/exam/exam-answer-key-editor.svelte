<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { Label } from '@cio/ui/base/label';
  import * as Card from '@cio/ui/base/card';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Empty from '@cio/ui/base/empty';

  /**
   * Correcting the answer key of a paper people have already sat.
   *
   * The paper itself is never edited — candidates have read it, and the sittings already
   * marked were measured against it. What changes is the key grading uses, recorded as a
   * correction and applied to every finished sitting at once. That is why each action here
   * says how many results it moved: a teacher fixing one option is re-marking a class.
   *
   * Two remedies, because a wrong key has two shapes. Where the right option is simply a
   * different one, the key is replaced. Where the question itself is unanswerable — no
   * option is right, or two are — nobody can be asked to have chosen correctly, so the
   * question is awarded to everyone.
   */

  export type AnswerKeyOption = { id: string; label: string; html: string };

  export type AnswerKeyQuestion = {
    questionId: number;
    position: number;
    points: number;
    promptHtml: string;
    options: AnswerKeyOption[];
    effectiveKey: string[];
    keyFixable: boolean;
    hasSeveralChoiceParts: boolean;
    awarded: boolean;
    corrected: boolean;
  };

  let {
    questions,
    busyQuestionId = null,
    onfix,
    onaward
  }: {
    questions: AnswerKeyQuestion[];
    busyQuestionId?: number | null;
    onfix: (question: AnswerKeyQuestion, correctedKey: string[]) => void;
    onaward: (question: AnswerKeyQuestion) => void;
  } = $props();

  let editing = $state<number | null>(null);
  let draft = $state<string[]>([]);
  let awarding = $state<AnswerKeyQuestion | null>(null);

  function beginEdit(question: AnswerKeyQuestion) {
    editing = question.questionId;
    draft = [...question.effectiveKey];
  }

  function toggle(optionId: string, checked: boolean) {
    draft = checked ? [...draft, optionId] : draft.filter((id) => id !== optionId);
  }

  /** Nothing to save until the teacher has actually chosen something different. */
  function changed(question: AnswerKeyQuestion): boolean {
    if (draft.length === 0) return false;
    if (draft.length !== question.effectiveKey.length) return true;

    const sorted = [...question.effectiveKey].sort();
    return ![...draft].sort().every((id, index) => id === sorted[index]);
  }

  function labelsOf(question: AnswerKeyQuestion, key: string[]): string {
    const labels = key
      .map((id) => question.options.find((option) => option.id === id)?.label)
      .filter((label): label is string => Boolean(label));

    return labels.length > 0 ? labels.join(', ') : $t('exam.corrections.no_key');
  }
</script>

{#if questions.length === 0}
  <Empty.Root>
    <Empty.Content>
      <Empty.Title>{$t('exam.corrections.empty')}</Empty.Title>
    </Empty.Content>
  </Empty.Root>
{:else}
  <div class="ui:space-y-4">
    {#each questions as question (question.questionId)}
      {@const busy = busyQuestionId === question.questionId}
      <Card.Root>
        <Card.Header>
          <div class="ui:flex ui:flex-wrap ui:items-center ui:gap-2">
            <Card.Title class="ui:text-base">
              {$t('exam.corrections.question_number', { position: String(question.position) })}
            </Card.Title>
            {#if question.corrected}
              <Badge variant="secondary">{$t('exam.corrections.corrected_badge')}</Badge>
            {/if}
            {#if question.awarded}
              <Badge variant="secondary">{$t('exam.corrections.awarded_badge')}</Badge>
            {/if}
          </div>
          {#if question.promptHtml}
            <Card.Description>
              <SafeHtmlContent content={question.promptHtml} />
            </Card.Description>
          {/if}
        </Card.Header>

        <Card.Content class="ui:space-y-4">
          {#if editing === question.questionId}
            <fieldset class="ui:space-y-2">
              <legend class="ui:text-sm ui:font-medium">{$t('exam.corrections.pick_correct')}</legend>
              {#each question.options as option (option.id)}
                <div class="ui:flex ui:items-start ui:gap-2">
                  <Checkbox
                    id={`key-${question.questionId}-${option.id}`}
                    checked={draft.includes(option.id)}
                    onCheckedChange={(checked) => toggle(option.id, checked === true)}
                  />
                  <Label for={`key-${question.questionId}-${option.id}`} class="ui:font-normal">
                    <span class="ui:font-medium">{option.label}.</span>
                    <SafeHtmlContent content={option.html} />
                  </Label>
                </div>
              {/each}
            </fieldset>

            <div class="ui:flex ui:flex-wrap ui:gap-2">
              <Button size="sm" disabled={busy || !changed(question)} onclick={() => onfix(question, draft)}>
                {busy ? $t('exam.corrections.saving') : $t('exam.corrections.save_key')}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onclick={() => (editing = null)}>
                {$t('exam.corrections.cancel')}
              </Button>
            </div>
          {:else}
            <p class="ui:text-sm">
              <span class="ui:text-muted-foreground">{$t('exam.corrections.current_key')}</span>
              <span class="ui:font-medium">{labelsOf(question, question.effectiveKey)}</span>
            </p>

            <div class="ui:flex ui:flex-wrap ui:gap-2">
              {#if question.keyFixable && !question.hasSeveralChoiceParts}
                <Button size="sm" variant="outline" disabled={busy} onclick={() => beginEdit(question)}>
                  {$t('exam.corrections.fix_key')}
                </Button>
              {/if}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || question.awarded}
                onclick={() => (awarding = question)}
              >
                {$t('exam.corrections.award')}
              </Button>
            </div>

            {#if question.hasSeveralChoiceParts}
              <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.corrections.several_parts')}</p>
            {:else if !question.keyFixable}
              <p class="ui:text-muted-foreground ui:text-xs">{$t('exam.corrections.not_choice')}</p>
            {/if}
          {/if}
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
{/if}

<Dialog.Root open={awarding !== null} onOpenChange={(open) => !open && (awarding = null)}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{$t('exam.corrections.award')}</Dialog.Title>
      <Dialog.Description>
        {$t('exam.corrections.award_explainer', { position: String(awarding?.position ?? '') })}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (awarding = null)}>{$t('exam.corrections.cancel')}</Button>
      <Button
        onclick={() => {
          const question = awarding;
          awarding = null;
          if (question) onaward(question);
        }}
      >
        {$t('exam.corrections.award_confirm')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
