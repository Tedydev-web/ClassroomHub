<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as UnderlineTabs from '@cio/ui/custom/underline-tabs';

  import { t } from '$lib/utils/functions/translations';

  /**
   * The four screens of one exam, as one screen with four tabs.
   *
   * They were four separate routes reached from four different places — results from the
   * sidebar, the answer keys from a button on results, the preview and the settings from a
   * menu on the list — so a teacher who arrived at the results had no way to the settings
   * without going back to the list first. An exercise has carried tabs for this all along;
   * an exam had nothing.
   *
   * Still four routes, because each is worth linking to on its own and every existing link
   * keeps working. The tabs only make them reachable from each other.
   */
  let { courseId, examId }: { courseId: string; examId: string } = $props();

  const TABS = [
    { value: 'results', label: () => $t('exam.manage.results') },
    { value: 'corrections', label: () => $t('exam.corrections.title') },
    { value: 'preview', label: () => $t('exam.preview.title') },
    { value: 'edit', label: () => $t('exam.manage.settings_tab') }
  ] as const;

  const base = $derived(`/courses/${courseId}/exams/${examId}`);

  // Read from the address rather than held as state: arriving by link, by tab, or by the
  // browser's own back button all have to agree on which tab is the current one.
  const active = $derived(TABS.find((tab) => page.url.pathname.endsWith(`/${tab.value}`))?.value ?? 'results');

  function select(value: string) {
    if (value === active) return;

    goto(`${base}/${value}`);
  }
</script>

<UnderlineTabs.Root value={active} onValueChange={select} class="ui:mb-4">
  <UnderlineTabs.List class="ui:grid ui:w-full ui:max-w-xl ui:grid-cols-4">
    {#each TABS as tab (tab.value)}
      <UnderlineTabs.Trigger value={tab.value}>{tab.label()}</UnderlineTabs.Trigger>
    {/each}
  </UnderlineTabs.List>
</UnderlineTabs.Root>
