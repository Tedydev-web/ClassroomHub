<script lang="ts">
  import type { AssessmentDeliveryDefinition, AssessmentResponseEnvelope } from '@cio/question-types';
  import { Checkbox } from '../../base/checkbox';
  import { Label } from '../../base/label';
  import * as RadioGroup from '../../base/radio-group';
  import { Textarea } from '../../base/textarea';
  import { sanitizeHtml } from '../../tools/sanitize';

  interface Props {
    definition: AssessmentDeliveryDefinition;
    response?: AssessmentResponseEnvelope | null;
    disabled?: boolean;
    onResponseChange?: (response: AssessmentResponseEnvelope) => void;
  }

  let { definition, response = null, disabled = false, onResponseChange = () => {} }: Props = $props();
  const rendererId = $props.id();

  const responsesByInteractionId = $derived(
    new Map((response?.responses ?? []).map((entry) => [entry.interactionId, entry.response]))
  );

  function updateResponse(
    interactionId: string,
    nextResponse: AssessmentResponseEnvelope['responses'][number]['response']
  ) {
    const nextResponses = (response?.responses ?? []).filter((entry) => entry.interactionId !== interactionId);
    nextResponses.push({ interactionId, response: nextResponse });
    onResponseChange({ schemaVersion: 1, responses: nextResponses });
  }

  function toggleChoiceOption(interactionId: string, selectedOptionIds: string[], optionId: string) {
    const nextSelectedOptionIds = selectedOptionIds.includes(optionId)
      ? selectedOptionIds.filter((selectedOptionId) => selectedOptionId !== optionId)
      : [...selectedOptionIds, optionId];

    updateResponse(interactionId, { kind: 'choice', selectedOptionIds: nextSelectedOptionIds });
  }

  function renderAuthoredHtml(html: string): string {
    return sanitizeHtml(html);
  }
</script>

<div class="ui:space-y-6">
  {#each definition.blocks as block}
    {#if block.kind === 'content'}
      <div class="ui:prose ui:max-w-none">{@html renderAuthoredHtml(block.content.html)}</div>
    {:else if block.interaction.kind === 'choice'}
      {@const interaction = block.interaction}
      {@const selectedOptionIds =
        responsesByInteractionId.get(block.id)?.kind === 'choice'
          ? (responsesByInteractionId.get(block.id)?.selectedOptionIds ?? [])
          : []}
      <fieldset class="ui:space-y-3" {disabled}>
        <legend class="ui:font-medium">{@html renderAuthoredHtml(interaction.prompt.html)}</legend>
        {#if interaction.config.cardinality === 'single'}
          <RadioGroup.Root
            value={selectedOptionIds[0] ?? ''}
            {disabled}
            onValueChange={(optionId) => updateResponse(block.id, { kind: 'choice', selectedOptionIds: [optionId] })}
          >
            <div class="ui:space-y-2">
              {#each interaction.config.options as option}
                {@const optionElementId = `${rendererId}-${block.id}-${option.id}`}
                <div class="ui:flex ui:items-start ui:gap-2">
                  <RadioGroup.Item id={optionElementId} value={option.id} />
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
                  onCheckedChange={() => toggleChoiceOption(block.id, selectedOptionIds, option.id)}
                />
                <Label class="ui:cursor-pointer ui:font-normal" for={optionElementId}
                  >{@html renderAuthoredHtml(option.html)}</Label
                >
              </div>
            {/each}
          </div>
        {/if}
      </fieldset>
    {:else if block.interaction.kind === 'text'}
      {@const interaction = block.interaction}
      {@const text =
        responsesByInteractionId.get(block.id)?.kind === 'text'
          ? (responsesByInteractionId.get(block.id)?.text ?? '')
          : ''}
      {@const textElementId = `${rendererId}-${block.id}`}
      <div class="ui:space-y-3">
        <Label for={textElementId} class="ui:font-medium">{@html renderAuthoredHtml(interaction.prompt.html)}</Label>
        <Textarea
          id={textElementId}
          value={text}
          {disabled}
          maxlength={interaction.config.maxCharacters}
          oninput={(event) => updateResponse(block.id, { kind: 'text', text: event.currentTarget.value })}
        />
      </div>
    {/if}
  {/each}
</div>
