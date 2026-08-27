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
  import { SafeHtmlContent } from '@cio/ui/custom/safe-html-content';
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

  let { courseId, importId }: Props = $props();

  let sortMode = $state<'review' | 'document'>('review');
  let answerKey = $state('');
  let activeQuestionId = $state<string | null>(null);
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
  const activeQuestionView = $derived(
    questionViews.find((view) => view.question.id === activeQuestionId) ?? questionViews[0] ?? null
  );
  /**
   * The API classifies every finding by what the teacher has to do about it. Read rather
   * than recomputed here so the dashboard carries no second copy of the mapping; the
   * fallback only covers a response from an API older than the classification.
   */
  type FindingClass = 'input_missing' | 'source_defect' | 'extraction_uncertain';
  const findingClassOf = (finding: { class?: string }): FindingClass =>
    finding.class === 'input_missing' || finding.class === 'source_defect' ? finding.class : 'extraction_uncertain';

  const blockingFindings = $derived(draftView?.findings.filter((finding) => finding.blocking) ?? []);

  /**
   * Findings grouped by what the teacher has to do about them, and deduplicated by code.
   * Forty identical "no answer key" rows say the same thing forty times and bury the one
   * finding that needs a human; one row per code with a count says it once.
   */
  const findingGroups = $derived.by(() => {
    const groups = new Map<
      FindingClass,
      Array<{ code: string; messageKey: string; questionId: string | null; count: number }>
    >();

    for (const finding of blockingFindings) {
      const group = findingClassOf(finding);
      const bucket = groups.get(group) ?? [];
      const existing = bucket.find((entry) => entry.code === finding.code);
      if (existing) existing.count += 1;
      else
        bucket.push({ code: finding.code, messageKey: finding.messageKey, questionId: finding.questionId, count: 1 });
      groups.set(group, bucket);
    }

    return (['input_missing', 'source_defect', 'extraction_uncertain'] as const)
      .map((group) => ({ group, entries: groups.get(group) ?? [] }))
      .filter((entry) => entry.entries.length > 0);
  });

  const missingAnswerKeyCount = $derived(
    blockingFindings.filter((finding) => findingClassOf(finding) === 'input_missing').length
  );

  /** Opened when there is something to resolve: the remedy must not be behind a click. */
  const reviewToolsOpen = $derived(blockingFindings.length > 0);
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
  const activeSharedContent = $derived(
    activeQuestionView?.question.passageId === null
      ? null
      : (draftView?.draft.sharedContents.find((content) => content.id === activeQuestionView?.question.passageId) ??
          null)
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

  function selectQuestion(questionId: string) {
    activeQuestionId = questionId;
  }

  function focusNextFlaggedQuestion() {
    if (flaggedQuestionIds.length === 0) return;

    const currentIndex = activeQuestionId ? flaggedQuestionIds.indexOf(activeQuestionId) : -1;
    const nextQuestionId = flaggedQuestionIds[(currentIndex + 1) % flaggedQuestionIds.length];
    if (nextQuestionId) selectQuestion(nextQuestionId);
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

<div class="w-full px-4 py-6 sm:px-6 lg:px-8">
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
          : missingAnswerKeyCount === blockingFindings.length
            ? $t('exam_import.review.blocking_summary_answer_key')
            : $t('exam_import.review.blocking_summary_mixed', { count: String(blockingFindings.length) })}
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

    <details class="ui:border-border mb-6 rounded-md border p-4" open={reviewToolsOpen}>
      <summary
        class="ui:focus-visible:ring-ring cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        {$t('exam_import.review.review_tools')}
      </summary>
      <div class="mt-4 grid gap-6 lg:grid-cols-2">
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
          <Button variant="secondary" disabled={!answerKey.trim() || examImportApi.isLoading} onclick={applyAnswerKey}>
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
            {#each findingGroups as group (group.group)}
              <div class="space-y-2">
                <h3 class="text-sm font-medium">{$t(`exam_import.findings.${group.group}_title`)}</h3>
                <p class="ui:text-muted-foreground text-xs">
                  {group.group === 'input_missing'
                    ? $t('exam_import.findings.input_missing_answer_key', {
                        count: String(group.entries.reduce((total, entry) => total + entry.count, 0))
                      })
                    : $t(`exam_import.findings.${group.group}_help`, {
                        count: String(group.entries.reduce((total, entry) => total + entry.count, 0))
                      })}
                </p>
                <ul class="space-y-1">
                  {#each group.entries as entry (entry.code)}
                    <li>
                      {#if entry.questionId}
                        <Button
                          variant="ghost"
                          class="h-auto w-full justify-start px-2 py-2 text-left text-sm whitespace-normal"
                          onclick={() => selectQuestion(entry.questionId!)}
                        >
                          {$t(entry.messageKey)}
                          {#if entry.count > 1}
                            <Badge variant="outline" class="ml-2"
                              >{$t('exam_import.findings.occurrences', { count: String(entry.count) })}</Badge
                            >
                          {/if}
                        </Button>
                      {:else}
                        <p class="px-2 py-2 text-sm">{$t(entry.messageKey)}</p>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          {/if}
        </section>
      </div>
    </details>

    <div class="grid min-w-0 gap-6 xl:grid-cols-[minmax(20rem,5fr)_minmax(28rem,7fr)]">
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        role="region"
        class="ui:border-border min-w-0 overflow-y-auto rounded-md border xl:max-h-[calc(100dvh-12rem)]"
        aria-labelledby="exam-import-source-heading"
        tabindex="0"
      >
        <div class="space-y-6 p-4 sm:p-6">
          {#key importId}
            <ExamImportDraftSettings {courseId} {importId} draft={draftView.draft} />
          {/key}

          <div class="ui:border-border border-t pt-5">
            <h2 id="exam-import-source-heading" class="text-base font-semibold">
              {$t('exam_import.review.shared_contents')}
            </h2>
            {#if activeSharedContent}
              <div class="prose prose-sm mt-4 max-w-none">
                <SafeHtmlContent content={activeSharedContent.html} />
              </div>
            {:else}
              <p class="ui:text-muted-foreground mt-3 text-sm">
                {$t('exam_import.review.no_linked_shared_content')}
              </p>
            {/if}
          </div>
        </div>
      </div>

      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        role="region"
        class="ui:border-border min-w-0 overflow-y-auto rounded-md border xl:max-h-[calc(100dvh-12rem)]"
        aria-labelledby="exam-import-questions-heading"
        tabindex="0"
      >
        <header
          class="ui:border-border ui:bg-background sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b p-4"
        >
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
        </header>

        <details class="ui:border-border border-b p-3">
          <summary
            class="ui:focus-visible:ring-ring cursor-pointer rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {$t('exam_import.review.question_queue')}
          </summary>
          <div class="mt-3 flex flex-wrap gap-2">
            {#each questionViews as view (view.question.id)}
              <Button
                type="button"
                variant={activeQuestionView?.question.id === view.question.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-current={activeQuestionView?.question.id === view.question.id ? 'step' : undefined}
                onclick={() => selectQuestion(view.question.id)}
              >
                {$t('exam_import.review.question_number', { number: view.documentIndex + 1 })}
              </Button>
            {/each}
          </div>
        </details>

        <div class="p-4 sm:p-6">
          {#if activeQuestionView}
            {#key activeQuestionView.question.id}
              <ExamImportQuestionCard
                {courseId}
                {importId}
                question={activeQuestionView.question}
                findings={activeQuestionView.findings}
                sharedContents={sharedContentOptions}
                questionNumber={activeQuestionView.documentIndex + 1}
                aiSuggestionEligible={aiSuggestionQuestionIds.includes(activeQuestionView.question.id)}
                aiSuggestionSelected={selectedAiQuestionIds.has(activeQuestionView.question.id)}
                onAiSuggestionSelectionChange={setAiSuggestionSelection}
              />
            {/key}
          {/if}
        </div>
      </div>
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
