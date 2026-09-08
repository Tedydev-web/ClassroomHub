<script>
  import { PageHeader } from '$lib/components';
  import { t } from '$lib/i18n';

  /**
   * @typedef {Object} Props
   * @property {import('svelte').Snippet} [children]
   */

  /** @type {Props} */
  let { children } = $props();
</script>

<PageHeader className="flex flex-col items-center justify-center text-center pb-8">
  <div class="mb-2 flex w-full items-center justify-center">
    <span
      class="rounded-full border-2 border-[#C2D2FF] bg-[#DCE5FF] px-4 py-1 text-sm font-medium text-blue-700"
      style="color: rgb(75, 85, 99);"
    >
      {$t('legal.legal')}
    </span>
  </div>
  <h1 class="text-4xl font-semibold text-slate-900 md:text-5xl">Terms of Service</h1>
</PageHeader>

<section class="mx-auto w-[90%] max-w-3xl px-4 py-12 lg:w-[60%]">
  <!-- The policy text itself is published in English; saying so is more honest
       than a machine translation of a document that has legal effect. -->
  <p class="ui:text-muted-foreground mb-8 text-sm">{$t('legal.english_is_authoritative')}</p>
  <article class="prose prose-slate prose-headings:scroll-mt-24 prose-a:text-blue-700 max-w-none">
    {@render children?.()}
  </article>
</section>
