<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import * as Alert from '@cio/ui/base/alert';
  import { Badge } from '@cio/ui/base/badge';
  import { Button } from '@cio/ui/base/button';
  import * as Dialog from '@cio/ui/base/dialog';
  import { Spinner } from '@cio/ui/base/spinner';
  import * as ToggleGroup from '@cio/ui/base/toggle-group';
  import { InputField } from '@cio/ui/custom/input-field';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import SparklesIcon from '@lucide/svelte/icons/sparkles';
  import XIcon from '@lucide/svelte/icons/x';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { examImportApi } from '$features/course/api';
  import ExamImportDraftSettings from '$features/course/components/exercise/exam-import-draft-settings.svelte';
  import ExamImportQuestionCard from '$features/course/components/exercise/exam-import-question-card.svelte';
  import {
    getExamImportFailureDescriptionKey,
    getExamImportQuestionViews
  } from '$features/course/utils/exam-import-utils';
  import { t } from '$lib/utils/functions/translations';
  import { SvelteSet } from 'svelte/reactivity';
  import type { ExamImportAiSuggestionEstimate } from '$features/course/utils/types';

  interface Props {
    courseId: string;
    importId: string;
  }

  const QUESTION_PAGE_SIZE = 10;

  let { courseId, importId }: Props = $props();

  let sortMode = $state<'review' | 'document'>('review');
  let answerKey = $state('');
  let activeQuestionId = $state<string | null>(null);
  let visibleQuestionCount = $state(QUESTION_PAGE_SIZE);
  let aiSuggestionDialogOpen = $state(false);
  let aiSuggestionEstimate = $state<ExamImportAiSuggestionEstimate | null>(null);
  let aiSuggestionLoading = $state(false);
  let aiSuggestionPending = $state(false);
  let selectedAiQuestionIds = new SvelteSet<string>();
  let selectedDraftUpdatedAt = $state<string | null>(null);

  const status = $derived(examImportApi.status);
  const draftView = $derived(examImportApi.draftView);
  const questionViews = $derived(
    draftView ? getExamImportQuestionViews(draftView.draft, draftView.findings, sortMode) : []
  );
  const visibleQuestionViews = $derived(questionViews.slice(0, visibleQuestionCount));
  const blockingFindings = $derived(draftView?.findings.filter((finding) => finding.blocking) ?? []);
  const flaggedQuestionIds = $derived(
    questionViews
      .filter((view) => view.findings.length > 0 || view.question.review !== 'clean')
      .map((view) => view.question.id)
  );
  const aiSuggestionQuestionIds = $derived(draftView?.aiSuggestionQuestionIds ?? []);
  const selectedAiQuestionCount = $derived(
    [...selectedAiQuestionIds].filter((questionId) => aiSuggestionQuestionIds.includes(questionId)).length
  );
  const sharedContentOptions = $derived(
    (draftView?.draft.sharedContents ?? []).map((content, index) => ({
      id: content.id,
      label: $t(`exam_import.review.shared_content_${content.kind}`, { number: index + 1 }),
      html: content.html
    }))
  );

  onMount(() => {
    examImportApi.reset();
    void examImportApi.pollUntilReady(courseId, importId);

    return () => examImportApi.stopPolling();
  });

  $effect(() => {
    const draftUpdatedAt = draftView?.updatedAt ?? null;
    if (draftUpdatedAt === selectedDraftUpdatedAt) return;

    selectedAiQuestionIds.clear();
    selectedDraftUpdatedAt = draftUpdatedAt;
  });

  function goBack() {
    goto(resolve(`/courses/${courseId}/lessons`, {}));
  }

  function focusQuestion(questionId: string) {
    const questionIndex = questionViews.findIndex((view) => view.question.id === questionId);
    if (questionIndex >= visibleQuestionCount) visibleQuestionCount = questionIndex + 1;
    activeQuestionId = questionId;
    requestAnimationFrame(() => {
      document.getElementById(`exam-import-question-${questionId}`)?.focus();
    });
  }

  function focusNextFlaggedQuestion() {
    if (flaggedQuestionIds.length === 0) return;

    const currentIndex = activeQuestionId ? flaggedQuestionIds.indexOf(activeQuestionId) : -1;
    const nextQuestionId = flaggedQuestionIds[(currentIndex + 1) % flaggedQuestionIds.length];
    if (nextQuestionId) focusQuestion(nextQuestionId);
  }

  async function applyAnswerKey() {
    const updated = await examImportApi.applyAnswerKey(courseId, importId, answerKey);
    if (updated) answerKey = '';
  }

  async function publish() {
    const published = await examImportApi.publish(courseId, importId);
    if (!published) return;

    await goto(resolve(`/courses/${courseId}/exercises/${published.exerciseId}`, {}));
  }

  function retryStatus() {
    examImportApi.stopPolling();
    void examImportApi.pollUntilReady(courseId, importId);
  }

  async function cancelImport() {
    await examImportApi.cancel(courseId, importId);
  }

  function handleSortModeChange(value: string) {
    if (value !== 'review' && value !== 'document') return;

    sortMode = value;
    activeQuestionId = null;
    visibleQuestionCount = QUESTION_PAGE_SIZE;
  }

  function showMoreQuestions() {
    visibleQuestionCount += QUESTION_PAGE_SIZE;
  }

  function setAiSuggestionSelection(questionId: string, selected: boolean) {
    if (selected) selectedAiQuestionIds.add(questionId);
    else selectedAiQuestionIds.delete(questionId);
  }

  async function openAiSuggestionConfirmation() {
    const questionIds = [...selectedAiQuestionIds].filter((questionId) => aiSuggestionQuestionIds.includes(questionId));
    if (questionIds.length === 0) return;

    aiSuggestionLoading = true;
    try {
      const estimate = await examImportApi.estimateAiSuggestions(courseId, importId, questionIds);
      if (!estimate) return;

      aiSuggestionEstimate = estimate;
      aiSuggestionDialogOpen = true;
    } finally {
      aiSuggestionLoading = false;
    }
  }

  async function requestAiSuggestions() {
    const questionIds = [...selectedAiQuestionIds].filter((questionId) => aiSuggestionQuestionIds.includes(questionId));
    if (questionIds.length === 0 || !aiSuggestionEstimate?.available || !draftView) return;

    aiSuggestionLoading = true;
    try {
      const previousUpdatedAt = draftView.updatedAt;
      const queued = await examImportApi.requestAiSuggestions(courseId, importId, questionIds);
      if (!queued) return;

      aiSuggestionDialogOpen = false;
      aiSuggestionPending = true;
      void examImportApi.waitForDraftUpdate(courseId, importId, previousUpdatedAt).finally(() => {
        aiSuggestionPending = false;
      });
    } finally {
      aiSuggestionLoading = false;
    }
  }

  function handleAiSuggestionDialogChange(open: boolean) {
    aiSuggestionDialogOpen = open;
    if (!open) aiSuggestionEstimate = null;
  }

  function failureCode(failure: unknown): string {
    if (typeof failure !== 'object' || failure === null || !('code' in failure)) return '';

    return typeof failure.code === 'string' ? failure.code : '';
  }
</script>

<svelte:head>
  <title>{$t('exam_import.review.page_title')}</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
  <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-3">
      <Button variant="secondary" size="icon" aria-label={$t('exam_import.review.back')} onclick={goBack}>
        <ArrowLeftIcon class="size-4" />
      </Button>
      <div class="min-w-0">
        <h1 class="text-xl font-semibold sm:text-2xl">
          {draftView?.draft.title ?? $t('exam_import.review.heading')}
        </h1>
        <p class="ui:text-muted-foreground mt-1 text-sm">
          {$t('exam_import.review.description')}
        </p>
      </div>
    </div>

    {#if draftView}
      <Button onclick={publish} disabled={!draftView.publishable || examImportApi.isLoading}>
        {$t('exam_import.publish.action')}
      </Button>
    {/if}
  </header>

  {#if !draftView}
    <section class="ui:border-border flex min-h-72 flex-col items-center justify-center gap-4 border-y py-12">
      {#if status?.status === 'failed'}
        <TriangleAlertIcon class="ui:text-destructive size-8" />
        <div class="max-w-lg text-center">
          <h2 class="font-semibold">{$t('exam_import.status.failed')}</h2>
          <p class="ui:text-muted-foreground mt-1 text-sm">
            {$t(getExamImportFailureDescriptionKey(status.failure))}
          </p>
          {#if failureCode(status.failure)}
            <code class="ui:bg-muted mt-3 inline-block rounded px-2 py-1 text-xs">
              {failureCode(status.failure)}
            </code>
          {/if}
        </div>
        <Button variant="secondary" onclick={goBack}>{$t('exam_import.status.choose_another_file')}</Button>
      {:else if status?.status === 'canceled'}
        <div class="max-w-lg text-center">
          <h2 class="font-semibold">{$t('exam_import.status.canceled')}</h2>
          <p class="ui:text-muted-foreground mt-1 text-sm">{$t('exam_import.status.canceled_description')}</p>
        </div>
        <Button variant="secondary" onclick={goBack}>{$t('exam_import.status.choose_another_file')}</Button>
      {:else if examImportApi.error === 'exam_import.status.poll_timeout'}
        <TriangleAlertIcon class="ui:text-destructive size-8" />
        <div class="max-w-lg text-center">
          <h2 class="font-semibold">{$t('exam_import.status.taking_longer')}</h2>
          <p class="ui:text-muted-foreground mt-1 text-sm">{$t('exam_import.status.taking_longer_description')}</p>
        </div>
        <Button variant="secondary" onclick={retryStatus}>
          <RefreshCwIcon class="size-4" />
          {$t('exam_import.status.check_again')}
        </Button>
      {:else if examImportApi.error}
        <TriangleAlertIcon class="ui:text-destructive size-8" />
        <div class="max-w-lg text-center">
          <h2 class="font-semibold">{$t('exam_import.status.fetch_failed')}</h2>
          <p class="ui:text-muted-foreground mt-1 text-sm">{$t('exam_import.status.fetch_failed_description')}</p>
        </div>
        <Button variant="secondary" onclick={retryStatus}>
          <RefreshCwIcon class="size-4" />
          {$t('exam_import.status.check_again')}
        </Button>
      {:else}
        <Spinner class="size-7" />
        <div class="text-center" aria-live="polite">
          <h2 class="font-semibold">
            {$t(`exam_import.status.${status?.status ?? 'queued'}`)}
          </h2>
          <p class="ui:text-muted-foreground mt-1 text-sm">
            {$t('exam_import.status.processing_description')}
          </p>
        </div>
        <Button variant="secondary" disabled={examImportApi.isLoading} onclick={cancelImport}>
          <XIcon class="size-4" />
          {$t('exam_import.status.cancel_action')}
        </Button>
      {/if}
    </section>
  {:else}
    <div class="mb-6 flex flex-wrap items-center gap-2" aria-live="polite">
      <Badge variant={draftView.publishable ? 'secondary' : 'destructive'}>
        {draftView.publishable
          ? $t('exam_import.review.ready_to_publish')
          : $t('exam_import.review.blocking_count', { count: blockingFindings.length })}
      </Badge>
      <Badge variant="outline">
        {$t('exam_import.review.question_count', {
          count: draftView.draft.sections.flatMap((section) => section.questions).length
        })}
      </Badge>
      {#if aiSuggestionPending}
        <Badge variant="outline">{$t('exam_import.review.ai_suggestion_pending')}</Badge>
      {/if}
      <span class="ui:text-muted-foreground text-xs">
        {$t('exam_import.review.saved_automatically')}
      </span>
    </div>

    <div class="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <main class="min-w-0 space-y-8">
        {#key importId}
          <ExamImportDraftSettings {courseId} {importId} draft={draftView.draft} />
        {/key}

        <section class="space-y-4" aria-labelledby="exam-import-questions-heading">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="exam-import-questions-heading" class="text-base font-semibold">
                {$t('exam_import.review.questions')}
              </h2>
              <p class="ui:text-muted-foreground text-sm">
                {$t('exam_import.review.questions_description')}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              {#if flaggedQuestionIds.length > 0}
                <Button variant="secondary" size="sm" onclick={focusNextFlaggedQuestion}>
                  <ChevronDownIcon class="size-4" />
                  {$t('exam_import.review.next_flagged')}
                </Button>
              {/if}
              {#if aiSuggestionQuestionIds.length > 0}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={selectedAiQuestionCount === 0 || aiSuggestionLoading || aiSuggestionPending}
                  onclick={openAiSuggestionConfirmation}
                >
                  <SparklesIcon class="size-4" />
                  {$t('exam_import.review.ai_suggestion_action', { count: selectedAiQuestionCount })}
                </Button>
              {/if}
              <ToggleGroup.Root
                type="single"
                variant="outline"
                size="sm"
                value={sortMode}
                onValueChange={handleSortModeChange}
              >
                <ToggleGroup.Item value="review">{$t('exam_import.review.sort_review')}</ToggleGroup.Item>
                <ToggleGroup.Item value="document">{$t('exam_import.review.sort_document')}</ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
          </div>

          <div class="space-y-4">
            {#each visibleQuestionViews as view (view.question.id)}
              {#key view.question.id}
                <ExamImportQuestionCard
                  {courseId}
                  {importId}
                  question={view.question}
                  findings={view.findings}
                  sharedContents={sharedContentOptions}
                  questionNumber={view.documentIndex + 1}
                  aiSuggestionEligible={aiSuggestionQuestionIds.includes(view.question.id)}
                  aiSuggestionSelected={selectedAiQuestionIds.has(view.question.id)}
                  onAiSuggestionSelectionChange={setAiSuggestionSelection}
                />
              {/key}
            {/each}
            {#if visibleQuestionViews.length < questionViews.length}
              <div class="flex justify-center pt-2">
                <Button variant="secondary" onclick={showMoreQuestions}>
                  {$t('exam_import.review.load_more', {
                    count: Math.min(QUESTION_PAGE_SIZE, questionViews.length - visibleQuestionViews.length)
                  })}
                </Button>
              </div>
            {/if}
          </div>
        </section>
      </main>

      <aside class="space-y-6 xl:sticky xl:top-20 xl:self-start">
        <section class="space-y-3" aria-labelledby="exam-import-answer-key-heading">
          <div>
            <h2 id="exam-import-answer-key-heading" class="text-sm font-semibold">
              {$t('exam_import.answer_key.heading')}
            </h2>
            <p class="ui:text-muted-foreground text-xs">{$t('exam_import.answer_key.description')}</p>
          </div>
          <InputField
            label={$t('exam_import.answer_key.label')}
            placeholder={$t('exam_import.answer_key.placeholder')}
            bind:value={answerKey}
            errorMessage={examImportApi.errors.key ? $t(examImportApi.errors.key) : ''}
          />
          <Button
            class="w-full"
            variant="secondary"
            disabled={!answerKey.trim() || examImportApi.isLoading}
            onclick={applyAnswerKey}
          >
            {$t('exam_import.answer_key.apply')}
          </Button>
        </section>

        <section class="space-y-3" aria-labelledby="exam-import-findings-heading">
          <h2 id="exam-import-findings-heading" class="text-sm font-semibold">
            {$t('exam_import.review.blocking_findings')}
          </h2>
          {#if blockingFindings.length === 0}
            <p class="ui:text-muted-foreground text-sm">{$t('exam_import.review.no_blocking_findings')}</p>
          {:else}
            <Alert.Root variant="destructive">
              <TriangleAlertIcon />
              <Alert.Title>{$t('exam_import.review.resolve_before_publish')}</Alert.Title>
            </Alert.Root>
            <ul class="space-y-2">
              {#each blockingFindings as finding, findingIndex (`${finding.code}:${finding.questionId ?? ''}:${findingIndex}`)}
                <li>
                  {#if finding.questionId}
                    <Button
                      variant="ghost"
                      class="h-auto w-full justify-start px-2 py-2 text-left text-sm whitespace-normal"
                      onclick={() => focusQuestion(finding.questionId!)}
                    >
                      {$t(finding.messageKey)}
                    </Button>
                  {:else}
                    <p class="px-2 py-2 text-sm">{$t(finding.messageKey)}</p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <Button class="w-full" onclick={publish} disabled={!draftView.publishable || examImportApi.isLoading}>
          {$t('exam_import.publish.action')}
        </Button>
      </aside>
    </div>
  {/if}
</div>

<Dialog.Root open={aiSuggestionDialogOpen} onOpenChange={handleAiSuggestionDialogChange}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{$t('exam_import.review.ai_suggestion_confirm_heading')}</Dialog.Title>
      <Dialog.Description>{$t('exam_import.review.ai_suggestion_confirm_description')}</Dialog.Description>
    </Dialog.Header>

    {#if aiSuggestionEstimate}
      <div class="ui:border-border space-y-2 rounded-md border p-3 text-sm">
        <p>{$t('exam_import.review.ai_suggestion_question_count', { count: aiSuggestionEstimate.questionCount })}</p>
        <p>
          {$t('exam_import.review.ai_suggestion_token_upper_bound', {
            count: aiSuggestionEstimate.estimatedPromptTokens + aiSuggestionEstimate.maximumCompletionTokens
          })}
        </p>
        <p>
          {$t('exam_import.review.ai_suggestion_quota_upper_bound', {
            count: aiSuggestionEstimate.estimatedMaximumQuotaUnits
          })}
        </p>
        {#if aiSuggestionEstimate.model}
          <p class="ui:text-muted-foreground text-xs">
            {$t('exam_import.review.ai_suggestion_model', { model: aiSuggestionEstimate.model })}
          </p>
        {/if}
      </div>

      <p class="ui:text-muted-foreground text-sm">{$t('exam_import.review.ai_suggestion_teacher_confirmation')}</p>
      {#if !aiSuggestionEstimate.available}
        <Alert.Root variant="destructive">
          <TriangleAlertIcon />
          <Alert.Title>{$t('exam_import.review.ai_suggestion_unavailable')}</Alert.Title>
        </Alert.Root>
      {/if}
    {/if}

    <Dialog.Footer>
      <Button variant="outline" onclick={() => handleAiSuggestionDialogChange(false)}>
        {$t('exam_import.editor.cancel')}
      </Button>
      <Button disabled={!aiSuggestionEstimate?.available || aiSuggestionLoading} onclick={requestAiSuggestions}>
        <SparklesIcon class="size-4" />
        {$t('exam_import.review.ai_suggestion_confirm_action')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
