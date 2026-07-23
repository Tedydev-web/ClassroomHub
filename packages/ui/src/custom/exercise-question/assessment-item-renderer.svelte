<script lang="ts">
  import {
    QUESTION_TYPE_KEY,
    getTextareaAnswerCharacterCount,
    isAssessmentVerticalSliceResponseComplete,
    type AnswerData,
    type AssessmentDeliveryBlock,
    type AssessmentDeliveryDefinition,
    type AssessmentResponseEnvelope
  } from '@cio/question-types';
  import NumberBadge from '$src/base/number-badge/number-badge.svelte';
  import { Checkbox } from '../../base/checkbox';
  import { Label } from '../../base/label';
  import * as RadioGroup from '../../base/radio-group';
  import { Textarea } from '../../base/textarea';
  import { sanitizeHtml } from '../../tools/sanitize';
  import { createAssessmentRichTextAnswer, createAssessmentRichTextQuestion } from './assessment-rich-text-adapter';
  import { getExerciseQuestionRenderer } from './renderer-contract';
  import QuestionSurface from './question-surface.svelte';
  import QuestionTitle from './question-title.svelte';

  interface Props {
    definition: AssessmentDeliveryDefinition;
    response?: AssessmentResponseEnvelope | null;
    disabled?: boolean;
    title?: string | null;
    questionNumber?: number;
    interactionNumberStart?: number;
    questionNumberActive?: boolean;
    showContainer?: boolean;
    validationRequested?: boolean;
    validationMessage?: string;
    focusRequestKey?: number;
    onResponseChange?: (response: AssessmentResponseEnvelope) => void;
  }

  let {
    definition,
    response = null,
    disabled = false,
    title = '',
    questionNumber,
    interactionNumberStart = 1,
    questionNumberActive = true,
    showContainer = false,
    validationRequested = false,
    validationMessage = '',
    focusRequestKey,
    onResponseChange = () => {}
  }: Props = $props();
  const rendererId = $props.id();
  const RichTextRenderer = getExerciseQuestionRenderer(QUESTION_TYPE_KEY.TEXTAREA, 'take');
  type DeliveryContentBlock = Extract<AssessmentDeliveryBlock, { kind: 'content' }>;
  type DeliveryInteractionBlock = Extract<AssessmentDeliveryBlock, { kind: 'interaction' }>;

  const contentBlocks = $derived(
    definition.blocks.filter((block): block is DeliveryContentBlock => block.kind === 'content')
  );
  const interactionBlocks = $derived(
    definition.blocks.filter((block): block is DeliveryInteractionBlock => block.kind === 'interaction')
  );
  const usesSplitLayout = $derived(definition.presentation?.layout === 'passage_split');
  const showsInteractionNumbers = $derived(interactionBlocks.length > 1);

  const responsesByInteractionId = $derived(
    new Map((response?.responses ?? []).map((entry) => [entry.interactionId, entry.response]))
  );
  let handledFocusRequestKey = $state<number | undefined>(undefined);
  let focusTargetInteractionId = $state<string | null>(null);

  function updateResponse(
    interactionId: string,
    nextResponse: AssessmentResponseEnvelope['responses'][number]['response']
  ) {
    const nextResponses = (response?.responses ?? []).filter((entry) => entry.interactionId !== interactionId);
    const isEmptyChoice = nextResponse.kind === 'choice' && nextResponse.selectedOptionIds.length === 0;
    const interactionBlock = definition.blocks.find(
      (block) => block.kind === 'interaction' && block.id === interactionId
    );
    const textFormat =
      interactionBlock?.kind === 'interaction' && interactionBlock.interaction.kind === 'text'
        ? interactionBlock.interaction.config.format
        : 'plain';
    const isEmptyText =
      nextResponse.kind === 'text' &&
      (textFormat === 'rich'
        ? getTextareaAnswerCharacterCount(nextResponse.text) === 0
        : nextResponse.text.trim().length === 0);
    if (isEmptyChoice || isEmptyText) {
      onResponseChange({ schemaVersion: 1, responses: nextResponses });

      return;
    }

    nextResponses.push({ interactionId, response: nextResponse });
    onResponseChange({ schemaVersion: 1, responses: nextResponses });
  }

  function toggleChoiceOption(interactionId: string, selectedOptionIds: string[], optionId: string) {
    const nextSelectedOptionIds = selectedOptionIds.includes(optionId)
      ? selectedOptionIds.filter((selectedOptionId) => selectedOptionId !== optionId)
      : [...selectedOptionIds, optionId];

    updateResponse(interactionId, { kind: 'choice', selectedOptionIds: nextSelectedOptionIds });
  }

  function updateRichTextResponse(interactionId: string, answer: AnswerData | null) {
    if (answer === null) {
      updateResponse(interactionId, { kind: 'text', text: '' });

      return;
    }
    if (answer.type !== QUESTION_TYPE_KEY.TEXTAREA) {
      console.error(`Assessment rich-text renderer returned unsupported answer type "${answer.type}"`);

      return;
    }

    updateResponse(interactionId, { kind: 'text', text: answer.text });
  }

  function renderAuthoredHtml(html: string): string {
    return sanitizeHtml(html);
  }

  function isInteractionInvalid(block: Extract<AssessmentDeliveryBlock, { kind: 'interaction' }>): boolean {
    if (!validationRequested) return false;

    const blockResponses = (response?.responses ?? []).filter((entry) => entry.interactionId === block.id);

    return !isAssessmentVerticalSliceResponseComplete(
      { schemaVersion: definition.schemaVersion, blocks: [block] },
      { schemaVersion: 1, responses: blockResponses }
    );
  }

  const firstInvalidInteractionId = $derived.by(() => {
    for (const block of definition.blocks) {
      if (block.kind === 'interaction' && isInteractionInvalid(block)) return block.id;
    }

    return null;
  });

  $effect(() => {
    if (focusRequestKey === undefined || focusRequestKey === handledFocusRequestKey) return;

    handledFocusRequestKey = focusRequestKey;
    focusTargetInteractionId = firstInvalidInteractionId;
  });
</script>

{#snippet renderContentBlock(block: DeliveryContentBlock)}
  <div class="ui:prose ui:max-w-none">{@html renderAuthoredHtml(block.content.html)}</div>
{/snippet}

{#snippet renderInteractionBlock(block: DeliveryInteractionBlock, interactionIndex: number)}
  <div class="ui:flex ui:min-w-0 ui:items-start ui:gap-3">
    {#if showsInteractionNumbers}
      <span class="ui:min-w-6 ui:font-semibold ui:tabular-nums">{interactionNumberStart + interactionIndex}.</span>
    {/if}
    <div class="ui:min-w-0 ui:flex-1">
      {#if block.interaction.kind === 'choice'}
        {@const interaction = block.interaction}
        {@const invalid = isInteractionInvalid(block)}
        {@const errorElementId = `${rendererId}-${block.id}-error`}
        {@const selectedOptionIds =
          responsesByInteractionId.get(block.id)?.kind === 'choice'
            ? (responsesByInteractionId.get(block.id)?.selectedOptionIds ?? [])
            : []}
        <fieldset
          class="ui:space-y-3"
          {disabled}
          data-assessment-group-invalid={invalid ? 'true' : undefined}
          aria-describedby={invalid ? errorElementId : undefined}
          data-assessment-required={interaction.required ? 'true' : undefined}
          data-assessment-invalid={invalid ? 'true' : undefined}
        >
          <legend class="ui:font-medium">{@html renderAuthoredHtml(interaction.prompt.html)}</legend>
          {#if interaction.config.cardinality === 'single'}
            <RadioGroup.Root
              value={selectedOptionIds[0] ?? ''}
              {disabled}
              required={interaction.required}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorElementId : undefined}
              onValueChange={(optionId) => updateResponse(block.id, { kind: 'choice', selectedOptionIds: [optionId] })}
            >
              <div class="ui:space-y-2">
                {#each interaction.config.options as option}
                  {@const optionElementId = `${rendererId}-${block.id}-${option.id}`}
                  <div class="ui:flex ui:items-start ui:gap-2">
                    <RadioGroup.Item
                      id={optionElementId}
                      value={option.id}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? errorElementId : undefined}
                    />
                    <Label class="ui:cursor-pointer ui:font-normal" for={optionElementId}
                      >{@html renderAuthoredHtml(option.html)}</Label
                    >
                  </div>
                {/each}
              </div>
            </RadioGroup.Root>
          {:else}
            <div class="ui:space-y-2">
              {#each interaction.config.options as option}
                {@const optionElementId = `${rendererId}-${block.id}-${option.id}`}
                <div class="ui:flex ui:items-start ui:gap-2">
                  <Checkbox
                    id={optionElementId}
                    checked={selectedOptionIds.includes(option.id)}
                    {disabled}
                    aria-required={interaction.required}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? errorElementId : undefined}
                    onCheckedChange={() => toggleChoiceOption(block.id, selectedOptionIds, option.id)}
                  />
                  <Label class="ui:cursor-pointer ui:font-normal" for={optionElementId}
                    >{@html renderAuthoredHtml(option.html)}</Label
                  >
                </div>
              {/each}
            </div>
          {/if}
          {#if invalid}
            <p id={errorElementId} role="alert" class="ui:text-destructive ui:text-sm">{validationMessage}</p>
          {/if}
        </fieldset>
      {:else if block.interaction.kind === 'text'}
        {@const interaction = block.interaction}
        {@const invalid = isInteractionInvalid(block)}
        {@const errorElementId = `${rendererId}-${block.id}-error`}
        {@const promptElementId = `${rendererId}-${block.id}-prompt`}
        {@const text =
          responsesByInteractionId.get(block.id)?.kind === 'text'
            ? (responsesByInteractionId.get(block.id)?.text ?? '')
            : ''}
        {@const textElementId = `${rendererId}-${block.id}`}
        <div class="ui:space-y-3" data-assessment-invalid={invalid ? 'true' : undefined}>
          {#if interaction.config.format === 'rich'}
            {@const richTextQuestion = createAssessmentRichTextQuestion(block.id, interaction)}
            <div id={promptElementId} class="ui:font-medium">
              {@html renderAuthoredHtml(interaction.prompt.html)}
            </div>
            <div role="group" aria-labelledby={promptElementId} aria-describedby={invalid ? errorElementId : undefined}>
              <RichTextRenderer
                question={richTextQuestion}
                answer={createAssessmentRichTextAnswer(text)}
                {disabled}
                inputAriaLabelledby={promptElementId}
                inputAriaInvalid={invalid}
                inputAriaDescribedby={invalid ? errorElementId : undefined}
                inputFocusRequestKey={focusTargetInteractionId === block.id ? focusRequestKey : undefined}
                onAnswerChange={(answer) => updateRichTextResponse(block.id, answer)}
              />
            </div>
          {:else}
            <Label for={textElementId} class="ui:font-medium">{@html renderAuthoredHtml(interaction.prompt.html)}</Label
            >
            <Textarea
              id={textElementId}
              value={text}
              {disabled}
              required={interaction.required}
              minlength={interaction.config.minCharacters}
              maxlength={interaction.config.maxCharacters}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorElementId : undefined}
              oninput={(event) => updateResponse(block.id, { kind: 'text', text: event.currentTarget.value })}
            />
          {/if}
          {#if invalid}
            <p id={errorElementId} role="alert" class="ui:text-destructive ui:text-sm">{validationMessage}</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet content()}
  {#if questionNumber !== undefined || title?.trim()}
    <div class="ui:mb-4 ui:flex ui:items-center ui:gap-2">
      {#if questionNumber !== undefined}
        <NumberBadge number={questionNumber} active={questionNumberActive} />
      {/if}
      {#if title?.trim()}
        <QuestionTitle {title} class="ui:min-w-0 ui:flex-1" />
      {/if}
    </div>
  {/if}

  {#if usesSplitLayout}
    <div
      class="ui:grid ui:min-w-0 ui:gap-6 ui:lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      data-assessment-layout="split"
    >
      <div class="ui:min-w-0 ui:space-y-6 ui:lg:sticky ui:lg:top-4 ui:lg:self-start" data-assessment-panel="passage">
        {#each contentBlocks as block (block.id)}
          {@render renderContentBlock(block)}
        {/each}
      </div>
      <div class="ui:min-w-0 ui:space-y-6 ui:lg:border-l ui:lg:pl-6" data-assessment-panel="interactions">
        {#each interactionBlocks as block, interactionIndex (block.id)}
          {@render renderInteractionBlock(block, interactionIndex)}
        {/each}
      </div>
    </div>
  {:else}
    <div class="ui:space-y-6" data-assessment-layout="stacked">
      {#each definition.blocks as block (block.id)}
        {#if block.kind === 'content'}
          {@render renderContentBlock(block)}
        {:else}
          {@const interactionIndex = interactionBlocks.findIndex(
            (interactionBlock) => interactionBlock.id === block.id
          )}
          {@render renderInteractionBlock(block, interactionIndex)}
        {/if}
      {/each}
    </div>
  {/if}
{/snippet}

{#if showContainer}
  <QuestionSurface>
    {@render content()}
  </QuestionSurface>
{:else}
  {@render content()}
{/if}
