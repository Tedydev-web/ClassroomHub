<script lang="ts">
  import { onMount } from 'svelte';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import PackageIcon from '@lucide/svelte/icons/package-open';
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import { Button } from '@cio/ui/base/button';
  import { Spinner } from '@cio/ui/base/spinner';
  import * as FileDropZone from '@cio/ui/custom/file-drop-zone';
  import { InputField } from '@cio/ui/custom/input-field';
  import { t } from '$lib/utils/functions/translations';
  import { scormAdminApi } from '../api/scorm-admin.svelte';

  const MAX_PACKAGE_SIZE = 100 * 1024 * 1024;
  let selectedFile = $state<File | null>(null);
  let title = $state('');
  let uploading = $state(false);

  onMount(() => {
    void Promise.all([scormAdminApi.listPackages(), scormAdminApi.listReports()]);
  });

  function selectFiles(files: File[]) {
    selectedFile = files[0] ?? null;
    if (selectedFile && !title) title = selectedFile.name.replace(/\.zip$/i, '');
  }

  async function uploadPackage() {
    if (!selectedFile || !title.trim()) return;

    uploading = true;
    const imported = await scormAdminApi.upload(selectedFile, title.trim());
    uploading = false;
    if (imported) {
      selectedFile = null;
      title = '';
    }
  }

  function changeReportPage(page: number) {
    void scormAdminApi.listReports(page);
  }
</script>

<section class="space-y-5">
  <div>
    <h2 class="text-base font-semibold">{$t('scorm.packages.heading')}</h2>
    <p class="ui:text-muted-foreground text-sm">{$t('scorm.packages.description')}</p>
  </div>

  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <FileDropZone.Root
      accept=".zip,application/zip,application/x-zip-compressed"
      maxFiles={1}
      fileCount={selectedFile ? 1 : 0}
      maxFileSize={MAX_PACKAGE_SIZE}
      onUpload={selectFiles}
    >
      <FileDropZone.Trigger
        label={selectedFile?.name ?? $t('scorm.packages.drop_label')}
        formatMaxFiles={(_count) => $t('scorm.packages.drop_help')}
        formatMaxFilesAndSize={(size) => $t('scorm.packages.drop_size', { size })}
        formatMaxSize={(size) => $t('scorm.packages.drop_size', { size })}
      />
    </FileDropZone.Root>

    <div class="space-y-3">
      <InputField label={$t('scorm.packages.title_label')} bind:value={title} />
      <Button class="w-full" onclick={uploadPackage} loading={uploading} disabled={!selectedFile || !title.trim()}>
        {$t('scorm.packages.upload')}
      </Button>
    </div>
  </div>

  {#if scormAdminApi.isLoading && scormAdminApi.packages.length === 0}
    <div class="flex min-h-32 items-center justify-center"><Spinner class="ui:text-muted-foreground size-6" /></div>
  {:else if scormAdminApi.packages.length === 0}
    <div
      class="ui:border-border ui:text-muted-foreground flex min-h-32 items-center justify-center border border-dashed text-sm"
    >
      {$t('scorm.packages.empty')}
    </div>
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each scormAdminApi.packages as item (item.id)}
        <article class="ui:border-border ui:bg-card rounded-md border p-4">
          <div class="flex items-start gap-3">
            <PackageIcon class="ui:text-muted-foreground mt-0.5 size-5 shrink-0" />
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-sm font-medium">{item.title}</h3>
              <p class="ui:text-muted-foreground mt-1 text-xs">SCORM {item.version} · {item.fileCount} files</p>
            </div>
            <Button
              variant="secondary"
              size="icon"
              title={$t('scorm.packages.delete')}
              onclick={() => scormAdminApi.remove(item.id)}
            >
              <TrashIcon size={16} />
            </Button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<section class="mt-10 space-y-4">
  <div>
    <h2 class="text-base font-semibold">{$t('scorm.reports.heading')}</h2>
    <p class="ui:text-muted-foreground text-sm">{$t('scorm.reports.description')}</p>
  </div>

  {#if scormAdminApi.reportsLoading && !scormAdminApi.reports}
    <div class="flex min-h-32 items-center justify-center"><Spinner class="ui:text-muted-foreground size-6" /></div>
  {:else if (scormAdminApi.reports?.items.length ?? 0) === 0}
    <div
      class="ui:border-border ui:text-muted-foreground flex min-h-32 items-center justify-center border border-dashed text-sm"
    >
      {$t('scorm.reports.empty')}
    </div>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="ui:border-border ui:text-muted-foreground border-b text-xs">
          <tr>
            <th class="py-2 pr-4 font-medium">{$t('scorm.reports.learner')}</th>
            <th class="py-2 pr-4 font-medium">{$t('scorm.reports.content')}</th>
            <th class="py-2 pr-4 font-medium">{$t('scorm.reports.status')}</th>
            <th class="py-2 pr-4 font-medium">{$t('scorm.reports.score')}</th>
            <th class="py-2 font-medium">{$t('scorm.reports.time')}</th>
          </tr>
        </thead>
        <tbody>
          {#each scormAdminApi.reports?.items ?? [] as item (item.registration.id)}
            <tr class="ui:border-border border-b">
              <td class="py-3 pr-4">
                <div>{item.learner.fullname}</div>
                <div class="ui:text-muted-foreground text-xs">{item.learner.email}</div>
              </td>
              <td class="py-3 pr-4">
                <div>{item.course.title}</div>
                <div class="ui:text-muted-foreground text-xs">{item.lesson.title}</div>
              </td>
              <td class="py-3 pr-4">{item.registration.completionStatus} / {item.registration.successStatus}</td>
              <td class="py-3 pr-4">{item.registration.scoreRaw ?? '—'}</td>
              <td class="py-3">{Math.round(item.registration.totalTimeSeconds / 60)} min</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-between gap-3">
      <p class="ui:text-muted-foreground text-sm">
        {$t('scorm.reports.page', {
          page: scormAdminApi.reports?.page ?? 1,
          totalPages: scormAdminApi.reports?.totalPages ?? 1
        })}
      </p>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          size="icon"
          title={$t('scorm.reports.previous')}
          disabled={scormAdminApi.reportsLoading || (scormAdminApi.reports?.page ?? 1) <= 1}
          onclick={() => changeReportPage((scormAdminApi.reports?.page ?? 1) - 1)}
        >
          <ChevronLeftIcon size={16} />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          title={$t('scorm.reports.next')}
          disabled={scormAdminApi.reportsLoading ||
            (scormAdminApi.reports?.page ?? 1) >= (scormAdminApi.reports?.totalPages ?? 1)}
          onclick={() => changeReportPage((scormAdminApi.reports?.page ?? 1) + 1)}
        >
          <ChevronRightIcon size={16} />
        </Button>
      </div>
    </div>
  {/if}
</section>
