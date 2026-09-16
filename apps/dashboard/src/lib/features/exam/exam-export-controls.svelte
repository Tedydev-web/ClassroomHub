<script lang="ts">
  import { onMount } from 'svelte';

  import { t } from '$lib/utils/functions/translations';
  import { Button } from '@cio/ui/base/button';
  import {
    EXAM_EXPORT_LOCALES,
    EXAM_EXPORT_PAPERS,
    rememberedExamAnswerKeyChoice,
    rememberedExamExportLocale,
    rememberedExamExportPaper,
    storeExamAnswerKeyChoice,
    storeExamExportLocale,
    storeExamExportPaper,
    type ExamExportLocale,
    type ExamExportPaper
  } from '$features/exam/exam-export-preferences';

  /**
   * The decisions a teacher makes about a file, beside the button that produces one.
   *
   * Language and key are settings of the export rather than of the screen, so they sit where
   * the export is asked for rather than in a settings page. The same row appears above one
   * paper's results and above the course's, because the same two downloads appear on both.
   */
  let {
    locale = $bindable('en'),
    includeAnswerKey = $bindable(true),
    paper = $bindable('a5'),
    loading = false,
    onreload
  }: {
    locale?: ExamExportLocale;
    includeAnswerKey?: boolean;
    paper?: ExamExportPaper;
    loading?: boolean;
    onreload?: () => void;
  } = $props();

  // Read on mount rather than at first render: the server has no `localStorage`, and a value
  // read during server rendering would be a guess the client immediately contradicts.
  onMount(() => {
    locale = rememberedExamExportLocale();
    includeAnswerKey = rememberedExamAnswerKeyChoice();
    paper = rememberedExamExportPaper();
  });

  function chooseLocale(next: ExamExportLocale) {
    locale = next;
    storeExamExportLocale(next);
  }

  function choosePaper(next: ExamExportPaper) {
    paper = next;
    storeExamExportPaper(next);
  }

  function toggleAnswerKey() {
    includeAnswerKey = !includeAnswerKey;
    storeExamAnswerKeyChoice(includeAnswerKey);
  }
</script>

<div class="flex flex-wrap items-center justify-end gap-3">
  <div class="flex items-center gap-1.5">
    <span class="ui:text-muted-foreground text-xs">{$t('exam.results.export_language')}</span>
    {#each EXAM_EXPORT_LOCALES as option (option)}
      <Button size="sm" variant={locale === option ? 'default' : 'outline'} onclick={() => chooseLocale(option)}>
        {$t(`exam.results.export_language_${option}`)}
      </Button>
    {/each}
  </div>

  <div class="flex items-center gap-1.5">
    <span class="ui:text-muted-foreground text-xs">{$t('exam.results.export_paper')}</span>
    {#each EXAM_EXPORT_PAPERS as option (option)}
      <Button size="sm" variant={paper === option ? 'default' : 'outline'} onclick={() => choosePaper(option)}>
        {$t(`exam.results.export_paper_${option}`)}
      </Button>
    {/each}
  </div>

  <Button size="sm" variant={includeAnswerKey ? 'default' : 'outline'} onclick={toggleAnswerKey}>
    {includeAnswerKey ? $t('exam.results.print_with_key') : $t('exam.results.print_without_key')}
  </Button>

  {#if onreload}
    <Button variant="outline" size="sm" disabled={loading} onclick={onreload}>
      {loading ? $t('exam.results.loading') : $t('exam.results.reload')}
    </Button>
  {/if}
</div>
