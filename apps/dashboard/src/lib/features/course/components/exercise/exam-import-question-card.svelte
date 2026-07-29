<script lang="ts">
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import * as Dialog from '@cio/ui/base/dialog';
  import * as Field from '@cio/ui/base/field';
  import * as RadioGroup from '@cio/ui/base/radio-group';
  import * as Select from '@cio/ui/base/select';
  import { InputField } from '@cio/ui/custom/input-field';
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
  import { TextareaField } from '@cio/ui/custom/textarea-field';
  import { AssessmentItemRenderer } from '@cio/ui/custom/exercise-question';
  import CheckIcon from '@lucide/svelte/icons/check';
  import EditIcon from '@lucide/svelte/icons/pencil';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { RichTextField } from '$features/ui';
  import { examImportApi } from '$features/course/api';
  import type {
    ExamImportDiagnostic,
    ExamImportDraftPatchOperation,
    ExamImportQuestion
  } from '$features/course/utils/types';
  import {
    getQuestionSourceExcerpt,
    parseExamImportNumericAnswer,
    toExamImportDeliveryDefinition
  } from '$features/course/utils/exam-import-utils';
  import { t } from '$lib/utils/functions/translations';

  interface SharedContentOption {
    id: string;
    label: string;
    html: string;
  }

  interface Props {
    courseId: string;
    importId: string;
    question: ExamImportQuestion;
    findings: ExamImportDiagnostic[];
    sharedContents: SharedContentOption[];
    questionNumber: number;
    aiSuggestionEligible: boolean;
    aiSuggestionSelected: boolean;
    onAiSuggestionSelectionChange: (questionId: string, selected: boolean) => void;
  }

  let {
    courseId,
    importId,
    question,
    findings,
    sharedContents,
    questionNumber,
    aiSuggestionEligible,
    aiSuggestionSelected,
    onAiSuggestionSelectionChange
  }: Props = $props();

  let editorOpen = $state(false);
  let promptHtml = $state('');
  let points = $state('');
  let passageId = $state('__none__');
  let cognitiveLevel = $state('__none__');
  let cardinality = $state<'single' | 'multiple'>('single');
  let shortAnswers = $state('');
  let numericValue = $state('');
  let numericTolerance = $state('');
  let selectedSingleOptionId = $state('');
  let removeConfirmationVisible = $state(false);
  let confirmationSaving = $state(false);
  let optionDrafts = $state<Array<{ id: string; sourceLabel: string; html: string; order: number }>>([]);
  let statementDrafts = $state<Array<{ id: string; sourceLabel: string; html: string; order: number }>>([]);
  const selectedOptionIds = new SvelteSet<string>();
  const statementAnswers = new SvelteMap<string, boolean | null>();

  const sharedContent = $derived(
    question.passageId === null ? null : (sharedContents.find((content) => content.id === question.passageId) ?? null)
  );
  const definition = $derived(toExamImportDeliveryDefinition(question, sharedContent));
  const sourceExcerpt = $derived(getQuestionSourceExcerpt(question));
  const hasBlockingFinding = $derived(findings.some((finding) => finding.blocking));

  function seedEditor() {
    promptHtml = question.promptHtml;
    points = question.points === null ? '' : String(question.points);
    passageId = question.passageId ?? '__none__';
    cognitiveLevel = question.cognitiveLevel ?? '__none__';
    selectedOptionIds.clear();
    statementAnswers.clear();
    optionDrafts = [];
    statementDrafts = [];
    shortAnswers = '';
    numericValue = '';
    numericTolerance = '';
    removeConfirmationVisible = false;

    if (question.kind === 'choice') {
      cardinality = question.cardinality;
      optionDrafts = question.options.map((option) => ({ ...option }));
      for (const optionId of question.answerKey?.correctOptionIds ?? []) selectedOptionIds.add(optionId);
      selectedSingleOptionId = question.answerKey?.correctOptionIds[0] ?? '';
    } else if (question.kind === 'true_false_group') {
      statementDrafts = question.statements.map((statement) => ({ ...statement }));
      const answers = new Map(
        (question.answerKey?.answers ?? []).map((answer) => [answer.statementId, answer.correctValue])
      );
      for (const statement of question.statements) {
        statementAnswers.set(statement.id, answers.get(statement.id) ?? null);
      }
    } else if (question.kind === 'short_answer') {
      shortAnswers = question.answerKey?.acceptedAnswers.join('\n') ?? '';
    } else if (question.kind === 'numeric') {
      numericValue = question.answerKey ? String(question.answerKey.value) : '';
      numericTolerance =
        question.answerKey?.tolerance === null || question.answerKey?.tolerance === undefined
          ? ''
          : String(question.answerKey.tolerance);
    }
  }

  function handleEditorOpenChange(open: boolean) {
    editorOpen = open;
    if (open) seedEditor();
  }

  function addQuestionOperation(
    operations: ExamImportDraftPatchOperation[],
    field: 'promptHtml' | 'points' | 'passageId' | 'cognitiveLevel' | 'cardinality' | 'answerKey',
    value: unknown
  ) {
    operations.push({
      target: { kind: 'question_field', questionId: question.id, field },
      value
    });
  }

  function addCommonOperations(operations: ExamImportDraftPatchOperation[]) {
    if (promptHtml !== question.promptHtml) addQuestionOperation(operations, 'promptHtml', promptHtml);

    const nextPoints = points.trim() === '' ? null : Number(points);
    if ((nextPoints === null || Number.isFinite(nextPoints)) && nextPoints !== question.points) {
      addQuestionOperation(operations, 'points', nextPoints);
    }

    const nextPassageId = passageId === '__none__' ? null : passageId;
    if (nextPassageId !== question.passageId) addQuestionOperation(operations, 'passageId', nextPassageId);

    const nextCognitiveLevel = cognitiveLevel === '__none__' ? null : cognitiveLevel;
    if (nextCognitiveLevel !== question.cognitiveLevel) {
      addQuestionOperation(operations, 'cognitiveLevel', nextCognitiveLevel);
    }
  }

  function addChoiceOperations(operations: ExamImportDraftPatchOperation[]) {
    if (question.kind !== 'choice') return;

    if (cardinality !== question.cardinality) addQuestionOperation(operations, 'cardinality', cardinality);
    for (const option of optionDrafts) {
      const original = question.options.find((candidate) => candidate.id === option.id);
      if (!original) continue;
      if (option.sourceLabel !== original.sourceLabel) {
        operations.push({
          target: { kind: 'option_field', questionId: question.id, optionId: option.id, field: 'sourceLabel' },
          value: option.sourceLabel
        });
      }
      if (option.html !== original.html) {
        operations.push({
          target: { kind: 'option_field', questionId: question.id, optionId: option.id, field: 'html' },
          value: option.html
        });
      }
    }

    const correctOptionIds =
      cardinality === 'single' ? (selectedSingleOptionId ? [selectedSingleOptionId] : []) : [...selectedOptionIds];
    if (correctOptionIds.length > 0) {
      addQuestionOperation(operations, 'answerKey', { kind: 'choice', correctOptionIds });
    }
  }

  function addTrueFalseOperations(operations: ExamImportDraftPatchOperation[]) {
    if (question.kind !== 'true_false_group') return;

    for (const statement of statementDrafts) {
      const original = question.statements.find((candidate) => candidate.id === statement.id);
      if (!original) continue;
      if (statement.sourceLabel !== original.sourceLabel) {
        operations.push({
          target: {
            kind: 'statement_field',
            questionId: question.id,
            statementId: statement.id,
            field: 'sourceLabel'
          },
          value: statement.sourceLabel
        });
      }
      if (statement.html !== original.html) {
        operations.push({
          target: { kind: 'statement_field', questionId: question.id, statementId: statement.id, field: 'html' },
          value: statement.html
        });
      }
    }

    const answers = statementDrafts.map((statement) => ({
      statementId: statement.id,
      correctValue: statementAnswers.get(statement.id)
    }));
    if (
      answers.every(
        (answer): answer is { statementId: string; correctValue: boolean } => typeof answer.correctValue === 'boolean'
      )
    ) {
      addQuestionOperation(operations, 'answerKey', { kind: 'true_false_group', answers });
    }
  }

  function addTextOrNumericAnswerOperation(operations: ExamImportDraftPatchOperation[]) {
    if (question.kind === 'short_answer') {
      const acceptedAnswers = shortAnswers
        .split('\n')
        .map((answer) => answer.trim())
        .filter(Boolean);
      if (acceptedAnswers.length > 0) {
        addQuestionOperation(operations, 'answerKey', { kind: 'short_answer', acceptedAnswers });
      }
    } else if (question.kind === 'numeric') {
      const answerKey = parseExamImportNumericAnswer(numericValue, numericTolerance);
      if (answerKey) addQuestionOperation(operations, 'answerKey', answerKey);
    }
  }

  async function saveQuestion() {
    const operations: ExamImportDraftPatchOperation[] = [];
    addCommonOperations(operations);
    addChoiceOperations(operations);
    addTrueFalseOperations(operations);
    addTextOrNumericAnswerOperation(operations);
    if (operations.length === 0) {
      editorOpen = false;
      return;
    }

    const updated = await examImportApi.patchDraft(courseId, importId, operations);
    if (updated) editorOpen = false;
  }

  async function removeQuestion() {
    const updated = await examImportApi.patchDraft(courseId, importId, [
      { operation: 'remove_question', questionId: question.id }
    ]);
    if (updated) editorOpen = false;
  }

  async function confirmQuestion() {
    confirmationSaving = true;
    try {
      await examImportApi.patchDraft(courseId, importId, [{ operation: 'confirm_question', questionId: question.id }]);
    } finally {
      confirmationSaving = false;
    }
  }

  function toggleOption(optionId: string, checked: boolean) {
    if (checked) selectedOptionIds.add(optionId);
    else selectedOptionIds.delete(optionId);
  }
</script>

<article
  id={`exam-import-question-${question.id}`}
  tabindex="-1"
  class="ui:border-border focus:ring-ring scroll-mt-24 space-y-4 rounded-md border p-4 focus:ring-2 focus:outline-none sm:p-5"
>
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex min-w-0 items-center gap-2">
      <Badge variant={hasBlockingFinding ? 'destructive' : question.review === 'clean' ? 'secondary' : 'outline'}>
        {question.sourceNumber ??
          $t('exam_import.review.question_number', {
            number: questionNumber
          })}
      </Badge>
      <span class="ui:text-muted-foreground text-sm">
        {$t(`exam_import.confidence.${question.confidence}`)}
      </span>
      {#if sourceExcerpt}
        <span class="ui:text-muted-foreground text-xs">
          {$t('exam_import.review.source_excerpt', { location: sourceExcerpt })}
        </span>
      {/if}
    </div>
    <div class="flex flex-wrap gap-2">
      {#if aiSuggestionEligible}
        <div class="flex items-center gap-2">
          <Checkbox
            checked={aiSuggestionSelected}
            onCheckedChange={(checked) => onAiSuggestionSelectionChange(question.id, checked === true)}
            aria-label={$t('exam_import.review.select_for_ai_suggestion')}
          />
          <Field.Label class="text-xs">{$t('exam_import.review.select_for_ai_suggestion')}</Field.Label>
        </div>
      {/if}
      {#if question.review === 'needs_attention'}
        <Button variant="secondary" size="sm" disabled={confirmationSaving} onclick={confirmQuestion}>
          <CheckIcon class="size-4" />
          {$t('exam_import.review.confirm_question')}
        </Button>
      {/if}
      <Button variant="secondary" size="sm" onclick={() => handleEditorOpenChange(true)}>
        <EditIcon class="size-4" />
        {$t('exam_import.review.edit')}
      </Button>
    </div>
  </header>

  {#if findings.length > 0}
    <ul class="space-y-2" aria-label={$t('exam_import.review.question_findings')}>
      {#each findings as finding, findingIndex (finding.code + JSON.stringify(finding.target) + findingIndex)}
        <li
          class={finding.blocking
            ? 'ui:border-destructive/40 ui:bg-destructive/5 rounded-md border px-3 py-2 text-sm'
            : 'ui:border-border ui:bg-muted/30 rounded-md border px-3 py-2 text-sm'}
        >
          {finding.tier === 'assisted' ? finding.message : $t(finding.messageKey)}
        </li>
      {/each}
    </ul>
  {/if}

  {#if definition}
    <AssessmentItemRenderer
      {definition}
      disabled
      showItemHeader={false}
      trueLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.true_label')}
      falseLabel={$t('course.navItem.lessons.exercises.all_exercises.shared_question.true_false.false_label')}
      {questionNumber}
    />
  {:else}
    <div class="prose prose-sm max-w-none">
      <SafeHtmlContent content={question.rawHtml} />
    </div>
  {/if}
</article>

<Dialog.Root open={editorOpen} onOpenChange={handleEditorOpenChange}>
  <Dialog.Content class="max-h-[90vh] max-w-3xl! overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{$t('exam_import.editor.heading')}</Dialog.Title>
      <Dialog.Description>{$t('exam_import.editor.description')}</Dialog.Description>
    </Dialog.Header>

    <Field.Group>
      <Field.Set>
        <Field.Legend>{$t('exam_import.editor.content')}</Field.Legend>
        <Field.Group>
          <RichTextField label={$t('exam_import.editor.prompt')} bind:value={promptHtml} variant="compact" isRequired />
          <div class="grid gap-4 sm:grid-cols-3">
            <InputField label={$t('exam_import.editor.points')} type="number" min={0} step={0.01} bind:value={points} />
            <Select.Root type="single" bind:value={cognitiveLevel}>
              <Field.Field>
                <Field.Label>{$t('exam_import.editor.cognitive_level')}</Field.Label>
                <Select.Trigger class="w-full">
                  {$t(`exam_import.editor.cognitive.${cognitiveLevel}`)}
                </Select.Trigger>
              </Field.Field>
              <Select.Content>
                {#each ['__none__', 'NB', 'TH', 'VD', 'VDC'] as level (level)}
                  <Select.Item value={level}>{$t(`exam_import.editor.cognitive.${level}`)}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            <Select.Root type="single" bind:value={passageId}>
              <Field.Field>
                <Field.Label>{$t('exam_import.editor.shared_content')}</Field.Label>
                <Select.Trigger class="w-full">
                  {passageId === '__none__'
                    ? $t('exam_import.editor.no_shared_content')
                    : sharedContents.find((content) => content.id === passageId)?.label}
                </Select.Trigger>
              </Field.Field>
              <Select.Content>
                <Select.Item value="__none__">{$t('exam_import.editor.no_shared_content')}</Select.Item>
                {#each sharedContents as content (content.id)}
                  <Select.Item value={content.id}>{content.label}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </Field.Group>
      </Field.Set>

      {#if question.kind === 'choice'}
        <Field.Separator />
        <Field.Set>
          <Field.Legend>{$t('exam_import.editor.options_and_answer')}</Field.Legend>
          <Select.Root type="single" bind:value={cardinality}>
            <Field.Field>
              <Field.Label>{$t('exam_import.editor.cardinality')}</Field.Label>
              <Select.Trigger class="w-full">
                {$t(`exam_import.editor.cardinality_${cardinality}`)}
              </Select.Trigger>
            </Field.Field>
            <Select.Content>
              <Select.Item value="single">{$t('exam_import.editor.cardinality_single')}</Select.Item>
              <Select.Item value="multiple">{$t('exam_import.editor.cardinality_multiple')}</Select.Item>
            </Select.Content>
          </Select.Root>

          {#if cardinality === 'single'}
            <RadioGroup.Root bind:value={selectedSingleOptionId} class="space-y-3">
              {#each optionDrafts as option (option.id)}
                <div class="ui:border-border grid gap-3 rounded-md border p-3 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                  <RadioGroup.Item value={option.id} aria-label={$t('exam_import.editor.correct_answer')} />
                  <div class="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
                    <InputField label={$t('exam_import.editor.label')} bind:value={option.sourceLabel} />
                    <RichTextField label={$t('exam_import.editor.option')} bind:value={option.html} variant="compact" />
                  </div>
                </div>
              {/each}
            </RadioGroup.Root>
          {:else}
            <div class="space-y-3">
              {#each optionDrafts as option (option.id)}
                <div class="ui:border-border grid gap-3 rounded-md border p-3 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
                  <Checkbox
                    checked={selectedOptionIds.has(option.id)}
                    onCheckedChange={(checked) => toggleOption(option.id, checked === true)}
                    aria-label={$t('exam_import.editor.correct_answer')}
                  />
                  <div class="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
                    <InputField label={$t('exam_import.editor.label')} bind:value={option.sourceLabel} />
                    <RichTextField label={$t('exam_import.editor.option')} bind:value={option.html} variant="compact" />
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </Field.Set>
      {:else if question.kind === 'true_false_group'}
        <Field.Separator />
        <Field.Set>
          <Field.Legend>{$t('exam_import.editor.statements_and_answers')}</Field.Legend>
          <div class="space-y-3">
            {#each statementDrafts as statement (statement.id)}
              <div class="ui:border-border grid gap-3 rounded-md border p-3">
                <div class="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
                  <InputField label={$t('exam_import.editor.label')} bind:value={statement.sourceLabel} />
                  <RichTextField
                    label={$t('exam_import.editor.statement')}
                    bind:value={statement.html}
                    variant="compact"
                  />
                </div>
                <RadioGroup.Root
                  value={statementAnswers.get(statement.id) === null
                    ? ''
                    : statementAnswers.get(statement.id)
                      ? 'true'
                      : 'false'}
                  onValueChange={(value) => statementAnswers.set(statement.id, value === 'true')}
                  class="flex gap-4"
                >
                  <div class="flex items-center gap-2">
                    <RadioGroup.Item value="true" />
                    <Field.Label>{$t('exam_import.editor.true')}</Field.Label>
                  </div>
                  <div class="flex items-center gap-2">
                    <RadioGroup.Item value="false" />
                    <Field.Label>{$t('exam_import.editor.false')}</Field.Label>
                  </div>
                </RadioGroup.Root>
              </div>
            {/each}
          </div>
        </Field.Set>
      {:else if question.kind === 'short_answer'}
        <Field.Separator />
        <Field.Set>
          <Field.Legend>{$t('exam_import.editor.answer_key')}</Field.Legend>
          <TextareaField
            label={$t('exam_import.editor.accepted_answers')}
            helperMessage={$t('exam_import.editor.accepted_answers_help')}
            bind:value={shortAnswers}
          />
        </Field.Set>
      {:else if question.kind === 'numeric'}
        <Field.Separator />
        <Field.Set>
          <Field.Legend>{$t('exam_import.editor.answer_key')}</Field.Legend>
          <div class="grid gap-4 sm:grid-cols-2">
            <InputField label={$t('exam_import.editor.numeric_value')} type="number" bind:value={numericValue} />
            <InputField
              label={$t('exam_import.editor.numeric_tolerance')}
              type="number"
              min={0}
              bind:value={numericTolerance}
            />
          </div>
        </Field.Set>
      {:else if question.kind === 'unresolved'}
        <Field.Separator />
        <Field.Set>
          <Field.Legend>{$t('exam_import.editor.unresolved_heading')}</Field.Legend>
          <Field.Description>{$t('exam_import.editor.unresolved_help')}</Field.Description>
          {#if removeConfirmationVisible}
            <div class="ui:border-destructive/40 ui:bg-destructive/5 space-y-3 rounded-md border p-3">
              <p class="text-sm">{$t('exam_import.editor.remove_confirmation')}</p>
              <div class="flex justify-end gap-2">
                <Button variant="outline" onclick={() => (removeConfirmationVisible = false)}>
                  {$t('exam_import.editor.cancel')}
                </Button>
                <Button variant="destructive" onclick={removeQuestion} loading={examImportApi.isLoading}>
                  {$t('exam_import.editor.remove_question')}
                </Button>
              </div>
            </div>
          {:else}
            <Button variant="destructive" onclick={() => (removeConfirmationVisible = true)}>
              {$t('exam_import.editor.remove_question')}
            </Button>
          {/if}
        </Field.Set>
      {/if}
    </Field.Group>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => handleEditorOpenChange(false)}>
        {$t('exam_import.editor.cancel')}
      </Button>
      <Button onclick={saveQuestion} loading={examImportApi.isLoading}>
        {$t('exam_import.editor.save')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
