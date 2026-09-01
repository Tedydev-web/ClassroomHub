<script lang="ts">
  import { t } from '$lib/utils/functions/translations';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { Label } from '@cio/ui/base/label';
  import * as Card from '@cio/ui/base/card';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as RadioGroup from '@cio/ui/base/radio-group';
  import * as Empty from '@cio/ui/base/empty';
  import CheckIcon from '@lucide/svelte/icons/check';

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
    /** One row is one question; an item can contribute several, each with its own key. */
    interactionId: string;
    position: number;
    points: number;
    promptHtml: string;
    options: AnswerKeyOption[];
    effectiveKey: string[];
    cardinality: 'single' | 'multiple';
    keyFixable: boolean;
    /** How many questions the item holding this one contains; an award reaches all of them. */
    questionsInItem: number;
    /** The passage the question is asked about, shared by every question of its item. */
    contextHtml: string | null;
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

  /**
   * Questions gathered back into the items they were printed in.
   *
   * The list is one row per question, which is what a teacher needs to correct a key. But a
   * passage is read once and asked about six times, so repeating it six times would bury the
   * questions under it. Rows arrive in paper order, so an item is simply a run of rows that
   * share a question id.
   */
  const groups = $derived.by(() => {
    const built: Array<{ questionId: number; contextHtml: string | null; questions: AnswerKeyQuestion[] }> = [];

    for (const question of questions) {
      const last = built.at(-1);

      if (last && last.questionId === question.questionId) last.questions.push(question);
      else built.push({ questionId: question.questionId, contextHtml: question.contextHtml, questions: [question] });
    }

    return built;
  });

  let editing = $state<string | null>(null);
  let draft = $state<string[]>([]);
  let awarding = $state<AnswerKeyQuestion | null>(null);

  function beginEdit(question: AnswerKeyQuestion) {
    editing = question.interactionId;
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
  <div class="ui:space-y-6">
    {#each groups as group (group.questionId)}
      {#if group.contextHtml}
        <!--
          Once per item, and collapsed. A teacher needs the passage to judge whether a key is
          right and almost never otherwise, and repeating it above each of six questions
          would bury the questions it is there to serve.
        -->
        <details class="ui:border-border ui:bg-muted/30 ui:rounded-lg ui:border ui:px-4 ui:py-3">
          <summary class="ui:text-muted-foreground ui:cursor-pointer ui:text-sm ui:font-medium">
            {$t('exam.corrections.context', {
              from: String(group.questions[0]?.position ?? ''),
              to: String(group.questions.at(-1)?.position ?? '')
            })}
          </summary>
          <div class="ui:mt-3 ui:text-sm">
            <SafeHtmlContent content={group.contextHtml} />
          </div>
        </details>
      {/if}

      {#each group.questions as question (question.interactionId)}
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
            {#if editing === question.interactionId}
              <fieldset class="ui:space-y-2">
                <legend class="ui:text-sm ui:font-medium">{$t('exam.corrections.pick_correct')}</legend>
                {#if question.cardinality === 'single'}
                  <!--
                  One option, not a free choice of several. A candidate answering this
                  question sent exactly one option, and the grader compares the key against
                  what they sent by size before it compares by value — so a key naming two
                  would mark every candidate wrong on this question. The control that cannot
                  express that key is the honest way to say so.
                -->
                  <RadioGroup.Root
                    value={draft[0] ?? ''}
                    onValueChange={(value) => (draft = [value])}
                    class="ui:space-y-2"
                  >
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
                <Button size="sm" disabled={busy || !changed(question)} onclick={() => onfix(question, draft)}>
                  {busy ? $t('exam.corrections.saving') : $t('exam.corrections.save_key')}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onclick={() => (editing = null)}>
                  {$t('exam.corrections.cancel')}
                </Button>
              </div>
            {:else}
              <!--
              Every option, with the key marked among them.
              A letter on its own asks a teacher to judge a key they cannot see: whether A is
              the right answer to question five is not a question the character "A" can
              answer. This is the paper as the class read it, with the marking on top.
            -->
              {#if question.options.length > 0}
                <ul class="ui:space-y-1.5">
                  {#each question.options as option (option.id)}
                    {@const isKey = question.effectiveKey.includes(option.id)}
                    <li
                      class={[
                        'ui:flex ui:items-start ui:gap-2 ui:rounded-md ui:px-2 ui:py-1.5 ui:text-sm',
                        isKey ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : ''
                      ]}
                    >
                      <span class="ui:flex ui:size-5 ui:shrink-0 ui:items-center ui:justify-center">
                        {#if isKey}
                          <CheckIcon size={16} aria-label={$t('exam.corrections.is_key')} />
                        {/if}
                      </span>
                      <span class="ui:font-medium">{option.label}.</span>
                      <span class="ui:min-w-0"><SafeHtmlContent content={option.html} /></span>
                    </li>
                  {/each}
                </ul>

                {#if question.effectiveKey.length === 0}
                  <!-- Nothing is marked above, which is a fact about the paper rather than a gap here. -->
                  <p class="ui:text-destructive ui:text-xs">{$t('exam.corrections.no_key_warning')}</p>
                {/if}
              {:else}
                <p class="ui:text-sm">
                  <span class="ui:text-muted-foreground">{$t('exam.corrections.current_key')}</span>
                  <span class="ui:font-medium">{labelsOf(question, question.effectiveKey)}</span>
                </p>
              {/if}

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
    {/each}
  </div>
{/if}

<Dialog.Root open={awarding !== null} onOpenChange={(open) => !open && (awarding = null)}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{$t('exam.corrections.award')}</Dialog.Title>
      <!--
        An award is recorded against the item, so on a passage it reaches every question in
        it. Now that each question has its own row, the old wording named one number and
        quietly moved five others — a teacher would have found out from the results.
      -->
      <Dialog.Description>
        {(awarding?.questionsInItem ?? 1) > 1
          ? $t('exam.corrections.award_explainer_group', {
              position: String(awarding?.position ?? ''),
              count: String((awarding?.questionsInItem ?? 1) - 1)
            })
          : $t('exam.corrections.award_explainer', { position: String(awarding?.position ?? '') })}
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
