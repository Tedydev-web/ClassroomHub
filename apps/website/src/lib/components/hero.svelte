<script lang="ts">
  import { SALES_EMAIL } from '@cio/utils/constants';
  import { Button } from '@cio/ui/base/button';
  import { MachineTrainingLine } from '@cio/ui/custom/animation/machines';
  import CtaButton from './ui/cta-button.svelte';
  import { t } from '$lib/i18n';
</script>

<section class="relative px-4 pt-[72px] md:px-6 lg:pt-[88px]">
  <div
    class="rounded-t-wash relative mx-auto max-w-[1400px] overflow-hidden bg-[linear-gradient(135deg,#f7f9fc_0%,#eef2fa_60%,#e5ecf7_100%)] px-6 pt-16 pb-16 md:px-10 lg:pt-24 lg:pb-24"
  >
    <div class="cio-dotfield pointer-events-none absolute inset-0" aria-hidden="true"></div>
    <div
      class="hero-machine pointer-events-none absolute top-0 -right-40 hidden h-[760px] w-[1240px] opacity-30 md:block lg:-right-24"
      aria-hidden="true"
    >
      <MachineTrainingLine class="h-full w-full" />
    </div>
    <div
      class="pointer-events-none absolute right-0 bottom-0 left-0 h-40 bg-gradient-to-b from-transparent to-white"
      aria-hidden="true"
    ></div>

    <div class="max-w-content relative z-10 mx-auto">
      <h1 class="text-display max-w-[1040px] text-center text-balance text-gray-950 lg:text-left">
        {$t('hero.title_lead')}
        <em class="text-blue-700 not-italic">{$t('hero.title_accent')}</em>
      </h1>

      <div class="mt-8 flex flex-col items-center text-center lg:items-start lg:text-left">
        <p class="text-lead max-w-[580px]">
          {$t('hero.subtitle')}
        </p>

        <div class="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
          <Button href="mailto:{SALES_EMAIL}?subject=ClassroomHub demo">{$t('hero.book_demo')}</Button>
          <CtaButton href="/signup" variant="secondary">{$t('hero.start_free')}</CtaButton>
        </div>
      </div>
    </div>

    <div class="max-w-content relative z-30 mx-auto mt-16 w-full">
      <div class="overflow-hidden rounded-xl bg-white ring-1 ring-gray-200">
        <img
          src="/assets/assets/www/home/hero-academy.jpeg"
          alt="Branded customer academy on a custom domain — catalog, cohorts, AI tutor"
          width="2560"
          height="1440"
          class="block h-auto w-full"
          loading="eager"
          decoding="async"
        />
      </div>
    </div>
  </div>
</section>

<style>
  .hero-machine {
    --machine-ink: var(--color-blue-700);
    --machine-face: #eef2fa;
  }
</style>
