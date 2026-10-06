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
  <div class="mb-6 flex w-full items-center justify-center">
    <span
      class="text-label rounded-full border-2 border-[#C2D2FF] bg-[#DCE5FF] px-4 py-1 font-mono text-blue-700 uppercase"
      style="color: rgb(75, 85, 99);"
    >
      {$t('legal.legal')}
    </span>
  </div>
  <h1 class="text-title font-medium text-balance text-slate-900">Terms of Service</h1>
</PageHeader>

<section class="max-w-lede mx-auto w-full px-6 py-16 md:px-10 md:py-20">
  <!-- The policy text itself is published in English; saying so is more honest
       than a machine translation of a document that has legal effect. -->
  <p class="ui:text-muted-foreground mb-8 text-sm">{$t('legal.english_is_authoritative')}</p>
  <article class="prose prose-slate prose-headings:scroll-mt-24 prose-a:text-blue-700 max-w-none">
    {@render children?.()}
  </article>
</section>
