<script lang="ts">
  import {
    QUESTION_TYPE_KEY,
    groupAssessmentBlocksByPassage,
    getAssessmentVerticalSliceResponseProgress,
    getTextareaAnswerCharacterCount,
    isAssessmentVerticalSliceResponseComplete,
    type AnswerData,
    type AssessmentDeliveryBlock,
    type AssessmentDeliveryDefinition,
    type AssessmentResponseEnvelope,
    type ReleasedAssessmentFeedback
  } from '@cio/question-types';
  import NumberBadge from '$src/base/number-badge/number-badge.svelte';
  import { IsMobile } from '../../hooks/is-mobile.svelte';
  import { SPLIT_LAYOUT_BREAKPOINT } from './constants';
  import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import { Button } from '../../base/button';
  import { Checkbox } from '../../base/checkbox';
  import { Input } from '../../base/input';
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
    feedback?: ReleasedAssessmentFeedback[];
    feedbackLabel?: string;
    disabled?: boolean;
    title?: string | null;
    questionNumber?: number;
    interactionNumberStart?: number;
    questionNumberActive?: boolean;
    showItemHeader?: boolean;
    showContainer?: boolean;
    validationRequested?: boolean;
    validationMessage?: string;
    trueLabel: string;
    falseLabel: string;
    focusRequestKey?: number;
    passageWorkspaceLabels?: PassageWorkspaceLabels | null;
    onResponseChange?: (response: AssessmentResponseEnvelope) => void;
  }

  interface PassageWorkspaceLabels {
    passage: string;
    questions: string;
    navigation: string;
    locatePassage: string;
    showAllQuestions: string;
    showOneQuestion: string;
    previousQuestion: string;
    nextQuestion: string;
    formatPassage: (index: number) => string;
    formatQuestionRange: (start: number, end: number) => string;
    formatProgress: (answered: number, total: number) => string;
    formatAnsweredQuestion: (questionNumber: number) => string;
    formatUnansweredQuestion: (questionNumber: number) => string;
  }

  let {
    definition,
    response = null,
    feedback = [],
    feedbackLabel,
    disabled = false,
    title = '',
    questionNumber,
    interactionNumberStart = 1,
    questionNumberActive = true,
    showItemHeader = true,
    showContainer = false,
    validationRequested = false,
    validationMessage = '',
    trueLabel,
    falseLabel,
    focusRequestKey,
    passageWorkspaceLabels = null,
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
  const usesPassageWorkspace = $derived(usesSplitLayout && passageWorkspaceLabels !== null);
  const showsInteractionNumbers = $derived(interactionBlocks.length > 1);

  const responsesByInteractionId = $derived(
    new Map((response?.responses ?? []).map((entry) => [entry.interactionId, entry.response]))
  );
  const itemFeedback = $derived(feedback.filter((entry) => entry.scope === 'item'));
  const optionFeedback = $derived(feedback.filter((entry) => entry.scope === 'choice_option'));
  let handledFocusRequestKey = $state<number | undefined>(undefined);
  let focusTargetInteractionId = $state<string | null>(null);
  let passagePanel = $state<HTMLElement | null>(null);
  let questionPanel = $state<HTMLElement | null>(null);
  let activeQuestionGroupId = $state<string | null>(null);

  const passageGroups = $derived(groupAssessmentBlocksByPassage(definition.blocks));
  const passageGroupViews = $derived.by(() => {
    let passageIndex = 0;
    let interactionOffset = 0;

    return passageGroups.map((group) => {
      if (group.passage) passageIndex += 1;

      const questionStart = interactionNumberStart + interactionOffset;
      const questionEnd = questionStart + Math.max(0, group.interactions.length - 1);
      const groupResponseProgress = getAssessmentVerticalSliceResponseProgress(
        { schemaVersion: definition.schemaVersion, blocks: group.interactions },
        response
      );
      interactionOffset += group.interactions.length;

      return {
        ...group,
        passageIndex: Math.max(1, passageIndex),
        questionStart,
        questionEnd,
        answered: groupResponseProgress.answered,
        total: group.interactions.length
      };
    });
  });

  const activePassageGroupView = $derived(passageGroupViews.find((group) => group.id === activeQuestionGroupId));

  /**
   * A phone has room for one question at a time, so the questions panel pages
   * through them instead of scrolling a long column. The pager and its mode
   * switch only exist below `lg`; from there the panel always shows the whole
   * group, which is what the side-by-side layout is for.
   */
  /**
   * `null` means "follow the viewport": one question at a time where the passage and its
   * questions are stacked, all of them where they sit side by side. Choosing from the
   * toggle pins the mode instead, at any width — the control used to be hidden above
   * `lg`, which left a reader of a ten-question passage no way to page through it just
   * because their screen was wide.
   */
  let questionViewMode = $state<'single' | 'all' | null>(null);
  let activeInteractionId = $state<string | null>(null);
  const belowSplitLayout = new IsMobile(SPLIT_LAYOUT_BREAKPOINT);
  const isCompactViewport = $derived(belowSplitLayout.current);

  const answeredInteractionIds = $derived(
    new Set(
      interactionBlocks
        .filter(
          (block) =>
            getAssessmentVerticalSliceResponseProgress(
              { schemaVersion: definition.schemaVersion, blocks: [block] },
              response
            ).answered === 1
        )
        .map((block) => block.id)
    )
  );

  const pagerGroup = $derived(activePassageGroupView ?? passageGroupViews[0]);
  const pagerInteractions = $derived(pagerGroup?.interactions ?? []);
  const activeInteractionIndex = $derived(
    Math.max(
      0,
      pagerInteractions.findIndex((block) => block.id === activeInteractionId)
    )
  );
  const effectiveViewMode = $derived(questionViewMode ?? (isCompactViewport ? 'single' : 'all'));
  const pagesOneQuestion = $derived(effectiveViewMode === 'single');
  const activeQuestionNumber = $derived(
    pagerGroup && activeInteractionId ? pagerGroup.questionStart + activeInteractionIndex : null
  );

  // Keep the shown question inside the active group when the group changes.
  $effect(() => {
    const [firstInteraction] = pagerInteractions;
    if (!firstInteraction) return;
    if (pagerInteractions.some((block) => block.id === activeInteractionId)) return;

    activeInteractionId = firstInteraction.id;
  });

  function goToInteraction(interactionId: string) {
    activeInteractionId = interactionId;
    questionPanel?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function stepInteraction(offset: number) {
    const next = pagerInteractions[activeInteractionIndex + offset];
    if (next) goToInteraction(next.id);
  }

  function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * `headerOffset` is however much of the panel's top edge is covered by a sticky
   * header, so the group lands below it rather than under it. The questions panel
   * keeps its header outside the scrolling element and so needs no offset.
   */
  function scrollPanelToGroup(
    panel: HTMLElement | null,
    groupAttribute: 'data-assessment-passage-group' | 'data-assessment-question-group',
    groupId: string,
    behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth',
    headerOffset = 0
  ) {
    if (!panel) return;

    const group = panel.querySelector<HTMLElement>(`[${groupAttribute}="${groupId}"]`);
    if (!group) return;

    const panelRect = panel.getBoundingClientRect();
    const groupRect = group.getBoundingClientRect();
    panel.scrollTo({
      top: panel.scrollTop + groupRect.top - panelRect.top - headerOffset,
      behavior
    });
  }

  function selectPassageGroup(groupId: string) {
    activeQuestionGroupId = groupId;
    scrollPanelToGroup(passagePanel, 'data-assessment-passage-group', groupId, 'auto', 56);
    scrollPanelToGroup(questionPanel, 'data-assessment-question-group', groupId, 'auto');
  }

  /**
   * Passages number their gaps in the prose itself — `(3) ______` — and carry no anchor
   * to jump to, so the gap for the current question is found by matching that number in
   * the text.
   *
   * The match cannot be done text node by text node: only the first gap in a passage
   * tends to sit in one contiguous run, and the rest are cut in half by inline markup
   * (`<strong>(1</strong><strong>3)</strong>` and similar), which a per-node search
   * misses five times out of six. So the group's text is walked into one string, and the
   * offsets of the match are mapped back onto the nodes they came from.
   *
   * Best effort by design: a paper whose questions do not point at a numbered gap, such
   * as ordinary reading comprehension, simply gets no highlight.
   */
  const BLANK_HIGHLIGHT_NAME = 'assessment-blank';

  function clearPassageBlankHighlight() {
    CSS.highlights?.delete(BLANK_HIGHLIGHT_NAME);
  }

  function findBlankRange(scope: Node, questionNumber: number): Range | null {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let text = '';

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push(node as Text);
      text += node.textContent ?? '';
    }

    // Take the run of underscores after the number too, so the highlight covers the gap
    // the learner is filling and not just its label. Papers that only cite a number,
    // with no gap to fill, match the number alone.
    const match = new RegExp(`\\(\\s*${questionNumber}\\s*\\)\\s*_*`).exec(text);
    if (!match) return null;

    // Turn an offset into the flattened text back into the node that holds it.
    function locate(offset: number): [Text, number] | null {
      let consumed = 0;

      for (const node of nodes) {
        const length = node.textContent?.length ?? 0;
        if (offset <= consumed + length) return [node, offset - consumed];
        consumed += length;
      }

      return null;
    }

    const start = locate(match.index);
    const end = locate(match.index + match[0].length);
    if (!start || !end) return null;

    const range = document.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    return range;
  }

  function highlightPassageBlank(questionNumber: number | null) {
    const panel = passagePanel;
    if (!panel) return;

    clearPassageBlankHighlight();
    if (questionNumber === null) return;

    const group = activeQuestionGroupId
      ? panel.querySelector<HTMLElement>(`[data-assessment-passage-group="${activeQuestionGroupId}"]`)
      : null;
    const range = findBlankRange(group ?? panel, questionNumber);
    if (!range) return;

    // The Custom Highlight API paints the range without touching the passage markup, so
    // authored HTML is never rewritten and there is nothing to unpick afterwards. Where
    // it is missing the learner still gets the scroll, just without the tint.
    if (typeof Highlight === 'function') CSS.highlights?.set(BLANK_HIGHLIGHT_NAME, new Highlight(range));

    // Centre it within the passage panel by hand. `scrollIntoView` would also drag the
    // page itself on a phone, pulling the whole workspace out of view.
    const panelRect = panel.getBoundingClientRect();
    const blankRect = range.getBoundingClientRect();
    panel.scrollTo({
      top: panel.scrollTop + blankRect.top - panelRect.top - panel.clientHeight / 2 + blankRect.height / 2,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth'
    });
  }

  $effect(() => {
    if (!pagesOneQuestion) {
      clearPassageBlankHighlight();
      return;
    }

    highlightPassageBlank(activeQuestionNumber);
    return clearPassageBlankHighlight;
  });

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
    const isEmptyFillBlank =
      nextResponse.kind === 'fill_blank' && nextResponse.values.every((value) => value.trim() === '');
    if (isEmptyChoice || isEmptyText || isEmptyFillBlank) {
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

  function updateTrueFalseGroupResponse(
    interactionId: string,
    statementId: string,
    value: boolean,
    statementIds: string[]
  ) {
    const currentResponse = responsesByInteractionId.get(interactionId);
    const answersByStatementId = new Map(
      currentResponse?.kind === 'true_false_group'
        ? currentResponse.answers.map((answer) => [answer.statementId, answer.value])
        : []
    );
    answersByStatementId.set(statementId, value);
    const answers = statementIds.flatMap((currentStatementId) => {
      const currentValue = answersByStatementId.get(currentStatementId);

      return currentValue === undefined ? [] : [{ statementId: currentStatementId, value: currentValue }];
    });

    updateResponse(interactionId, { kind: 'true_false_group', answers });
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

  function getOptionFeedback(interactionId: string, optionId: string) {
    return optionFeedback.filter((entry) => entry.interactionId === interactionId && entry.optionId === optionId);
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

  $effect(() => {
    const groupIds = passageGroupViews.map((group) => group.id);
    const firstGroupId = groupIds[0] ?? null;
    if (!activeQuestionGroupId || !groupIds.includes(activeQuestionGroupId)) activeQuestionGroupId = firstGroupId;
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
                  {@const feedbackEntries = getOptionFeedback(block.id, option.id)}
                  {@const feedbackElementId = `${optionElementId}-feedback`}
                  <div class="ui:space-y-1">
                    <div class="ui:flex ui:items-start ui:gap-2">
                      <RadioGroup.Item
                        id={optionElementId}
                        value={option.id}
                        aria-invalid={invalid}
                        aria-describedby={[
                          invalid ? errorElementId : '',
                          feedbackEntries.length > 0 ? feedbackElementId : ''
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined}
                      />
                      <Label class="ui:cursor-pointer ui:font-normal" for={optionElementId}
                        >{@html renderAuthoredHtml(option.html)}</Label
                      >
                    </div>
                    {#if feedbackEntries.length > 0}
                      <div
                        id={feedbackElementId}
                        class="ui:border-border ui:bg-muted/30 ui:ml-6 ui:space-y-2 ui:border-l-2 ui:px-3 ui:py-2"
                        role="note"
                        aria-label={feedbackLabel}
                      >
                        {#each feedbackEntries as entry (entry.id)}
                          <div class="ui:prose ui:max-w-none">{@html renderAuthoredHtml(entry.html)}</div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </RadioGroup.Root>
          {:else}
            <div class="ui:space-y-2">
              {#each interaction.config.options as option}
                {@const optionElementId = `${rendererId}-${block.id}-${option.id}`}
                {@const feedbackEntries = getOptionFeedback(block.id, option.id)}
                {@const feedbackElementId = `${optionElementId}-feedback`}
                <div class="ui:space-y-1">
                  <div class="ui:flex ui:items-start ui:gap-2">
                    <Checkbox
                      id={optionElementId}
                      checked={selectedOptionIds.includes(option.id)}
                      {disabled}
                      aria-required={interaction.required}
                      aria-invalid={invalid}
                      aria-describedby={[
                        invalid ? errorElementId : '',
                        feedbackEntries.length > 0 ? feedbackElementId : ''
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined}
                      onCheckedChange={() => toggleChoiceOption(block.id, selectedOptionIds, option.id)}
                    />
                    <Label class="ui:cursor-pointer ui:font-normal" for={optionElementId}
                      >{@html renderAuthoredHtml(option.html)}</Label
                    >
                  </div>
                  {#if feedbackEntries.length > 0}
                    <div
                      id={feedbackElementId}
                      class="ui:border-border ui:bg-muted/30 ui:ml-6 ui:space-y-2 ui:border-l-2 ui:px-3 ui:py-2"
                      role="note"
                      aria-label={feedbackLabel}
                    >
                      {#each feedbackEntries as entry (entry.id)}
                        <div class="ui:prose ui:max-w-none">{@html renderAuthoredHtml(entry.html)}</div>
                      {/each}
                    </div>
                  {/if}
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
      {:else if block.interaction.kind === 'numeric'}
        {@const interaction = block.interaction}
        {@const invalid = isInteractionInvalid(block)}
        {@const errorElementId = `${rendererId}-${block.id}-error`}
        {@const inputElementId = `${rendererId}-${block.id}`}
        {@const value =
          responsesByInteractionId.get(block.id)?.kind === 'numeric'
            ? String(responsesByInteractionId.get(block.id)?.value ?? '')
            : ''}
        <div class="ui:space-y-3" data-assessment-invalid={invalid ? 'true' : undefined}>
          <Label for={inputElementId} class="ui:font-medium">{@html renderAuthoredHtml(interaction.prompt.html)}</Label>
          <Input
            id={inputElementId}
            type="number"
            {value}
            {disabled}
            required={interaction.required}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorElementId : undefined}
            oninput={(event) => {
              const nextValue = event.currentTarget.valueAsNumber;
              if (!Number.isFinite(nextValue)) {
                onResponseChange({
                  schemaVersion: 1,
                  responses: (response?.responses ?? []).filter((entry) => entry.interactionId !== block.id)
                });
                return;
              }
              updateResponse(block.id, { kind: 'numeric', value: nextValue });
            }}
          />
          {#if invalid}
            <p id={errorElementId} role="alert" class="ui:text-destructive ui:text-sm">{validationMessage}</p>
          {/if}
        </div>
      {:else if block.interaction.kind === 'fill_blank'}
        {@const interaction = block.interaction}
        {@const invalid = isInteractionInvalid(block)}
        {@const errorElementId = `${rendererId}-${block.id}-error`}
        {@const promptElementId = `${rendererId}-${block.id}-prompt`}
        {@const responseValues =
          responsesByInteractionId.get(block.id)?.kind === 'fill_blank'
            ? (responsesByInteractionId.get(block.id)?.values ?? [])
            : []}
        {@const values = Array.from(
          { length: interaction.config.blankCount },
          (_, index) => responseValues[index] ?? ''
        )}
        <fieldset class="ui:space-y-3" data-assessment-invalid={invalid ? 'true' : undefined}>
          <legend id={promptElementId} class="ui:font-medium"
            >{@html renderAuthoredHtml(interaction.prompt.html)}</legend
          >
          <div class="ui:grid ui:gap-3 ui:sm:grid-cols-2">
            {#each values as value, index (index)}
              <Input
                id={`${rendererId}-${block.id}-${index}`}
                {value}
                {disabled}
                required={interaction.required}
                aria-labelledby={promptElementId}
                aria-invalid={invalid}
                aria-describedby={invalid ? errorElementId : undefined}
                oninput={(event) => {
                  const nextValues = [...values];
                  nextValues[index] = event.currentTarget.value;
                  updateResponse(block.id, { kind: 'fill_blank', values: nextValues });
                }}
              />
            {/each}
          </div>
          {#if invalid}
            <p id={errorElementId} role="alert" class="ui:text-destructive ui:text-sm">{validationMessage}</p>
          {/if}
        </fieldset>
      {:else if block.interaction.kind === 'true_false_group'}
        {@const interaction = block.interaction}
        {@const invalid = isInteractionInvalid(block)}
        {@const errorElementId = `${rendererId}-${block.id}-error`}
        {@const statementIds = interaction.config.statements.map((statement) => statement.id)}
        {@const currentResponse = responsesByInteractionId.get(block.id)}
        {@const answersByStatementId = new Map(
          currentResponse?.kind === 'true_false_group'
            ? currentResponse.answers.map((answer) => [answer.statementId, answer.value])
            : []
        )}
        {@const hasMissingStatements = statementIds.some((statementId) => !answersByStatementId.has(statementId))}
        <fieldset
          class="ui:space-y-4"
          {disabled}
          data-assessment-group-invalid={invalid ? 'true' : undefined}
          aria-describedby={invalid ? errorElementId : undefined}
          data-assessment-required={interaction.required ? 'true' : undefined}
        >
          <legend class="ui:font-medium">{@html renderAuthoredHtml(interaction.prompt.html)}</legend>
          <div class="ui:divide-border ui:divide-y">
            {#each interaction.config.statements as statement, statementIndex (statement.id)}
              {@const statementElementId = `${rendererId}-${block.id}-${statement.id}`}
              {@const currentValue = answersByStatementId.get(statement.id)}
              {@const statementInvalid =
                invalid && (currentValue === undefined || (!hasMissingStatements && statementIndex === 0))}
              <div
                class="ui:grid ui:gap-3 ui:py-4 ui:sm:grid-cols-[minmax(0,1fr)_auto] ui:sm:items-center"
                data-assessment-invalid={statementInvalid ? 'true' : undefined}
              >
                <div id={`${statementElementId}-label`} class="ui:min-w-0 ui:text-sm">
                  <span class="ui:mr-2 ui:font-medium ui:tabular-nums">{statementIndex + 1}.</span>
                  {@html renderAuthoredHtml(statement.html)}
                </div>
                <RadioGroup.Root
                  value={currentValue === undefined ? '' : String(currentValue)}
                  {disabled}
                  required={interaction.required}
                  aria-labelledby={`${statementElementId}-label`}
                  aria-invalid={statementInvalid}
                  aria-describedby={statementInvalid ? errorElementId : undefined}
                  onValueChange={(nextValue) =>
                    updateTrueFalseGroupResponse(block.id, statement.id, nextValue === 'true', statementIds)}
                >
                  <div class="ui:flex ui:items-center ui:gap-4">
                    <div class="ui:flex ui:items-center ui:gap-2">
                      <RadioGroup.Item id={`${statementElementId}-true`} value="true" />
                      <Label for={`${statementElementId}-true`} class="ui:cursor-pointer ui:font-normal">
                        {trueLabel}
                      </Label>
                    </div>
                    <div class="ui:flex ui:items-center ui:gap-2">
                      <RadioGroup.Item id={`${statementElementId}-false`} value="false" />
                      <Label for={`${statementElementId}-false`} class="ui:cursor-pointer ui:font-normal">
                        {falseLabel}
                      </Label>
                    </div>
                  </div>
                </RadioGroup.Root>
              </div>
            {/each}
          </div>
          {#if invalid}
            <p id={errorElementId} role="alert" class="ui:text-destructive ui:text-sm">{validationMessage}</p>
          {/if}
        </fieldset>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet content()}
  {#if showItemHeader && (questionNumber !== undefined || title?.trim())}
    <div class="ui:mb-4 ui:flex ui:items-center ui:gap-2">
      {#if questionNumber !== undefined}
        <NumberBadge number={questionNumber} active={questionNumberActive} />
      {/if}
      {#if title?.trim()}
        <QuestionTitle {title} class="ui:min-w-0 ui:flex-1" />
      {/if}
    </div>
  {/if}

  {#if usesPassageWorkspace && passageWorkspaceLabels}
    <div
      class={['ui:bg-background ui:overflow-hidden', showContainer ? '' : 'ui:border-border ui:rounded-md ui:border']}
      data-assessment-layout="passage-workspace"
    >
      <details class="ui:border-border ui:border-b ui:px-4 ui:py-2">
        <summary
          class="ui:focus-visible:ring-ring ui:cursor-pointer ui:rounded-sm ui:text-sm ui:font-medium ui:outline-none ui:focus-visible:ring-2 ui:focus-visible:ring-offset-2"
        >
          {passageWorkspaceLabels.navigation}
        </summary>
        <nav class="ui:flex ui:flex-wrap ui:gap-2 ui:pt-3" aria-label={passageWorkspaceLabels.navigation}>
          {#each passageGroupViews as group (group.id)}
            <Button
              type="button"
              variant={activeQuestionGroupId === group.id ? 'secondary' : 'ghost'}
              size="sm"
              aria-current={activeQuestionGroupId === group.id ? 'step' : undefined}
              onclick={() => selectPassageGroup(group.id)}
            >
              {passageWorkspaceLabels.formatPassage(group.passageIndex)} ·
              {passageWorkspaceLabels.formatQuestionRange(group.questionStart, group.questionEnd)}
            </Button>
          {/each}
        </nav>
      </details>

      <!--
        Narrow screens stack the passage above its questions and keep it there while the
        learner works through them, so the text stays in view instead of being swapped out.
        Each row scrolls on its own; the passage only changes when a new group is selected.
        From `lg` the two become side-by-side columns.

        The height is the viewport's, less the chrome around it. It used to stop at 48rem
        as well, which on a tall screen left the passage scrolling inside a short box with
        a third of the page empty beneath it — the one place where more height is always
        worth having, because it is fewer scrolls through the text.
      -->
      <div
        class="ui:grid ui:h-[calc(100dvh-14rem)] ui:min-h-[28rem] ui:min-w-0 ui:grid-rows-[minmax(0,2fr)_minmax(0,3fr)] ui:lg:h-[calc(100dvh-11rem)] ui:lg:min-h-[36rem] ui:lg:grid-cols-[minmax(20rem,5fr)_minmax(28rem,7fr)] ui:lg:grid-rows-1"
      >
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <section
          id={`${rendererId}-passage-panel`}
          bind:this={passagePanel}
          class="ui:border-border ui:min-w-0 ui:overflow-y-auto ui:overscroll-contain ui:border-b ui:lg:border-b-0"
          aria-label={passageWorkspaceLabels.passage}
          tabindex="0"
        >
          <header
            class="ui:border-border ui:bg-background/95 ui:sticky ui:top-0 ui:z-10 ui:flex ui:min-h-14 ui:items-center ui:gap-2 ui:border-b ui:px-4 ui:backdrop-blur-sm"
          >
            <BookOpenTextIcon class="ui:text-muted-foreground ui:size-4" aria-hidden="true" />
            <span class="ui:text-sm ui:font-semibold">
              {passageWorkspaceLabels.passage}
            </span>
          </header>
          {#each passageGroupViews as group (group.id)}
            <article
              class="ui:min-h-full ui:px-5 ui:py-6 ui:sm:px-8"
              data-assessment-passage-group={group.id}
              aria-label={passageWorkspaceLabels.formatPassage(group.passageIndex)}
            >
              {#if group.passage}
                {@render renderContentBlock(group.passage)}
              {/if}
            </article>
          {/each}
        </section>

        <!--
          The header, the question pager and the previous/next controls are siblings of
          the scrolling element rather than sticky children of it, so they hold their
          position exactly instead of sliding under each other as the learner scrolls.
        -->
        <section
          id={`${rendererId}-questions-panel`}
          class="ui:flex ui:min-h-0 ui:min-w-0 ui:flex-col"
          aria-label={passageWorkspaceLabels.questions}
        >
          <header
            class="ui:border-border ui:bg-background ui:flex ui:min-h-14 ui:shrink-0 ui:items-center ui:justify-between ui:gap-3 ui:border-b ui:px-4"
          >
            <div class="ui:flex ui:min-w-0 ui:items-center ui:gap-2">
              <ListChecksIcon class="ui:text-muted-foreground ui:size-4 ui:shrink-0" aria-hidden="true" />
              <div class="ui:min-w-0">
                <p class="ui:truncate ui:text-sm ui:font-semibold">
                  {passageWorkspaceLabels.formatQuestionRange(
                    activePassageGroupView?.questionStart ?? interactionNumberStart,
                    activePassageGroupView?.questionEnd ?? interactionNumberStart
                  )}
                </p>
                <p class="ui:text-muted-foreground ui:text-xs">
                  {passageWorkspaceLabels.formatProgress(
                    activePassageGroupView?.answered ?? 0,
                    activePassageGroupView?.total ?? 0
                  )}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="ui:shrink-0"
              aria-pressed={effectiveViewMode === 'all'}
              onclick={() => (questionViewMode = effectiveViewMode === 'single' ? 'all' : 'single')}
            >
              {effectiveViewMode === 'single'
                ? passageWorkspaceLabels.showAllQuestions
                : passageWorkspaceLabels.showOneQuestion}
            </Button>
          </header>

          {#if pagesOneQuestion && pagerGroup}
            <!--
              One row, whatever the question count. It scrolls sideways only when the
              numbers genuinely overrun the width, which keeps a forty-question paper
              from turning this strip into five stacked rows of buttons.
            -->
            <nav
              class="ui:border-border ui:bg-background ui:flex ui:shrink-0 ui:gap-1.5 ui:overflow-x-auto ui:border-b ui:px-4 ui:py-3"
              aria-label={passageWorkspaceLabels.questions}
            >
              {#each pagerInteractions as block, index (block.id)}
                {@const questionNumber = pagerGroup.questionStart + index}
                {@const isAnswered = answeredInteractionIds.has(block.id)}
                <Button
                  type="button"
                  size="sm"
                  variant={block.id === activeInteractionId ? 'default' : isAnswered ? 'secondary' : 'outline'}
                  class="ui:size-9 ui:shrink-0 ui:p-0 ui:tabular-nums"
                  aria-current={block.id === activeInteractionId ? 'true' : undefined}
                  aria-label={isAnswered
                    ? passageWorkspaceLabels.formatAnsweredQuestion(questionNumber)
                    : passageWorkspaceLabels.formatUnansweredQuestion(questionNumber)}
                  onclick={() => goToInteraction(block.id)}
                >
                  {questionNumber}
                </Button>
              {/each}
            </nav>
          {/if}

          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div
            bind:this={questionPanel}
            class="ui:min-h-0 ui:flex-1 ui:overflow-y-auto ui:overscroll-contain"
            tabindex="0"
          >
            {#each passageGroupViews as group (group.id)}
              <!-- Paging shows one question, so the groups it is not in would only add blank scroll. -->
              {#if !pagesOneQuestion || group.id === pagerGroup?.id}
                <article
                  class="ui:min-h-full ui:px-5 ui:py-6 ui:sm:px-8"
                  data-assessment-question-group={group.id}
                  aria-label={passageWorkspaceLabels.formatQuestionRange(group.questionStart, group.questionEnd)}
                >
                  <div class="ui:space-y-8">
                    {#each group.interactions as block (block.id)}
                      {@const interactionIndex = interactionBlocks.findIndex(
                        (interactionBlock) => interactionBlock.id === block.id
                      )}
                      {#if !pagesOneQuestion || block.id === activeInteractionId}
                        {@render renderInteractionBlock(block, interactionIndex)}
                      {/if}
                    {/each}
                  </div>
                </article>
              {/if}
            {/each}
          </div>

          {#if pagesOneQuestion && pagerInteractions.length > 1}
            <div
              class="ui:border-border ui:bg-background ui:flex ui:shrink-0 ui:items-center ui:justify-between ui:gap-3 ui:border-t ui:px-4 ui:py-3"
            >
              <Button
                type="button"
                variant="outline"
                class="ui:min-h-11"
                disabled={activeInteractionIndex === 0}
                onclick={() => stepInteraction(-1)}
              >
                {passageWorkspaceLabels.previousQuestion}
              </Button>
              <span class="ui:text-muted-foreground ui:text-xs ui:tabular-nums">
                {activeInteractionIndex + 1}/{pagerInteractions.length}
              </span>
              <Button
                type="button"
                variant="outline"
                class="ui:min-h-11"
                disabled={activeInteractionIndex >= pagerInteractions.length - 1}
                onclick={() => stepInteraction(1)}
              >
                {passageWorkspaceLabels.nextQuestion}
              </Button>
            </div>
          {/if}
        </section>
      </div>
    </div>
  {:else if usesSplitLayout}
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

  {#if itemFeedback.length > 0}
    <div
      class="ui:border-border ui:bg-muted/30 ui:mt-4 ui:space-y-3 ui:border-l-2 ui:px-4 ui:py-3"
      role="note"
      aria-label={feedbackLabel}
    >
      {#each itemFeedback as entry (entry.id)}
        <div class="ui:prose ui:max-w-none">{@html renderAuthoredHtml(entry.html)}</div>
      {/each}
    </div>
  {/if}
{/snippet}

{#if showContainer}
  <QuestionSurface class={usesPassageWorkspace ? 'ui:overflow-hidden ui:p-0' : ''}>
    {@render content()}
  </QuestionSurface>
{:else}
  {@render content()}
{/if}
