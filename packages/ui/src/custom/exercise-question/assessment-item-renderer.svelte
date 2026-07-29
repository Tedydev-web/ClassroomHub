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
  import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text';
  import ListChecksIcon from '@lucide/svelte/icons/list-checks';
  import { Button } from '../../base/button';
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
    showPassage: string;
    showQuestions: string;
    formatPassage: (index: number) => string;
    formatQuestionRange: (start: number, end: number) => string;
    formatProgress: (answered: number, total: number) => string;
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
  let mobileWorkspacePanel = $state<'passage' | 'questions'>('questions');
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

  function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function scrollPanelToGroup(
    panel: HTMLElement | null,
    groupAttribute: 'data-assessment-passage-group' | 'data-assessment-question-group',
    groupId: string,
    behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
  ) {
    if (!panel) return;

    const group = panel.querySelector<HTMLElement>(`[${groupAttribute}="${groupId}"]`);
    if (!group) return;

    const panelRect = panel.getBoundingClientRect();
    const groupRect = group.getBoundingClientRect();
    const stickyHeaderOffset = 56;
    panel.scrollTo({
      top: panel.scrollTop + groupRect.top - panelRect.top - stickyHeaderOffset,
      behavior
    });
  }

  function selectPassageGroup(groupId: string) {
    activeQuestionGroupId = groupId;
    scrollPanelToGroup(passagePanel, 'data-assessment-passage-group', groupId, 'auto');
    scrollPanelToGroup(questionPanel, 'data-assessment-question-group', groupId, 'auto');
  }

  function selectMobileWorkspacePanel(panel: 'passage' | 'questions') {
    mobileWorkspacePanel = panel;
  }

  function handleMobileWorkspaceKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    event.stopPropagation();
    const nextPanel = event.key === 'ArrowLeft' ? 'passage' : 'questions';
    mobileWorkspacePanel = nextPanel;

    const toolbar = event.currentTarget;
    if (!(toolbar instanceof HTMLElement)) return;

    toolbar.querySelector<HTMLButtonElement>(`[data-assessment-mobile-panel="${nextPanel}"]`)?.focus();
  }

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
      <div
        class="ui:border-border ui:bg-muted/20 ui:grid ui:grid-cols-2 ui:border-b ui:p-1 ui:lg:hidden"
        role="toolbar"
        tabindex="-1"
        aria-label={passageWorkspaceLabels.navigation}
        onkeydown={handleMobileWorkspaceKeydown}
      >
        <Button
          type="button"
          variant={mobileWorkspacePanel === 'passage' ? 'secondary' : 'ghost'}
          class="ui:min-h-11"
          data-assessment-mobile-panel="passage"
          aria-pressed={mobileWorkspacePanel === 'passage'}
          aria-controls={`${rendererId}-passage-panel`}
          onclick={() => selectMobileWorkspacePanel('passage')}
        >
          <BookOpenTextIcon class="ui:size-4" aria-hidden="true" />
          {passageWorkspaceLabels.showPassage}
        </Button>
        <Button
          type="button"
          variant={mobileWorkspacePanel === 'questions' ? 'secondary' : 'ghost'}
          class="ui:min-h-11"
          data-assessment-mobile-panel="questions"
          aria-pressed={mobileWorkspacePanel === 'questions'}
          aria-controls={`${rendererId}-questions-panel`}
          onclick={() => selectMobileWorkspacePanel('questions')}
        >
          <ListChecksIcon class="ui:size-4" aria-hidden="true" />
          {passageWorkspaceLabels.showQuestions}
        </Button>
      </div>

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

      <div
        class="ui:grid ui:h-[min(44rem,calc(100dvh-14rem))] ui:min-h-[28rem] ui:min-w-0 ui:lg:h-[min(48rem,calc(100dvh-11rem))] ui:lg:min-h-[36rem] ui:lg:grid-cols-[minmax(20rem,5fr)_minmax(28rem,7fr)]"
      >
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <section
          id={`${rendererId}-passage-panel`}
          bind:this={passagePanel}
          class={[
            'ui:min-w-0 ui:overflow-y-auto ui:overscroll-contain ui:lg:block',
            mobileWorkspacePanel !== 'passage' ? 'ui:hidden' : ''
          ]}
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

        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <section
          id={`${rendererId}-questions-panel`}
          bind:this={questionPanel}
          class={[
            'ui:min-w-0 ui:overflow-y-auto ui:overscroll-contain ui:lg:block',
            mobileWorkspacePanel !== 'questions' ? 'ui:hidden' : ''
          ]}
          aria-label={passageWorkspaceLabels.questions}
          tabindex="0"
        >
          <header
            class="ui:border-border ui:bg-background/95 ui:sticky ui:top-0 ui:z-10 ui:flex ui:min-h-14 ui:items-center ui:justify-between ui:gap-3 ui:border-b ui:px-4 ui:backdrop-blur-sm"
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
          </header>

          {#each passageGroupViews as group (group.id)}
            <article
              class="ui:min-h-full ui:px-5 ui:py-6 ui:sm:px-8"
              data-assessment-question-group={group.id}
              aria-label={passageWorkspaceLabels.formatQuestionRange(group.questionStart, group.questionEnd)}
            >
              <div class="ui:border-border ui:mb-6 ui:border-b ui:pb-3">
                <p class="ui:text-sm ui:font-semibold">
                  {passageWorkspaceLabels.formatQuestionRange(group.questionStart, group.questionEnd)}
                </p>
                <p class="ui:text-muted-foreground ui:text-xs">
                  {passageWorkspaceLabels.formatProgress(group.answered, group.total)}
                </p>
              </div>
              <div class="ui:space-y-8">
                {#each group.interactions as block (block.id)}
                  {@const interactionIndex = interactionBlocks.findIndex(
                    (interactionBlock) => interactionBlock.id === block.id
                  )}
                  {@render renderInteractionBlock(block, interactionIndex)}
                {/each}
              </div>
            </article>
          {/each}
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
