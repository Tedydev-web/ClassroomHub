<script lang="ts">
  import { PageSignupCTA, PageHeader } from '$lib/components';
  import { t } from '$lib/i18n';
  import { Button } from '@cio/ui/base/button';
  import * as Accordion from '@cio/ui/base/accordion';

  const whyStart = $derived(
    [
      ['anywhere', '/assets/assets/www/teach/teach-from-anywhere.svg'],
      ['paid', '/assets/assets/www/teach/get-paid.svg'],
      ['inspire', '/assets/assets/www/teach/inspire-learners.svg']
    ].map(([key, src]) => ({
      src,
      header: $t(`teach.why.${key}.header`),
      subText: $t(`teach.why.${key}.subtext`)
    }))
  );

  const steps = $derived(
    ['signup', 'record', 'launch', 'sell'].map((key) => ({
      title: $t(`teach.steps.${key}.title`),
      subText: $t(`teach.steps.${key}.subtext`)
    }))
  );

  const faqs = $derived(
    ['tutors', 'equipment', 'apply', 'earn'].map((value) => ({
      value,
      question: $t(`teach.faqs.${value}.question`),
      answer: $t(`teach.faqs.${value}.answer`)
    }))
  );
</script>

<svelte:head>
  <title>{$t('teach.title')}</title>
  <meta property="og:image" itemprop="image" content="/assets/brand/og/teach.png" />
  <meta property="og:title" content={$t('teach.og_title')} />
  <meta property="og:description" content={$t('teach.og_description')} />

  <meta property="og:image:secure_url" itemprop="image" content="/assets/brand/og/teach.png" />

  <meta name="twitter:title" content={$t('teach.og_title')} />
  <meta name="twitter:description" content={$t('teach.og_description')} />
  <meta name="twitter:image" content="/assets/brand/og/teach.png" />
</svelte:head>

<section>
  <PageHeader className="flex items-center justify-evenly px-5 flex-wrap text-left">
    <div>
      <h1 class="text-3xl lg:text-5xl">{$t('teach.heading')}</h1>
      <p class="my-5 text-center lg:w-[77%] lg:text-left">
        {$t('teach.subhead')}
      </p>

      <Button href="/teach/register" target="_blank">{$t('teach.register')}</Button>
    </div>

    <div class=" ">
      <img src="/assets/assets/www/teach/teacher-hero.png" alt="" class="w-full" />
    </div>
  </PageHeader>

  <div class="mx-auto mt-10">
    <div class="border-b border-slate-100 px-[10%] pb-10">
      <h1 class="flex items-center justify-center gap-3 pb-28 text-center text-3xl">
        {$t('teach.why_heading')} <img src="/assets/assets/www/teach/star.svg" alt="" />
      </h1>

      <div class="mt-10 flex flex-wrap justify-center lg:justify-between">
        {#each whyStart as why}
          <figure
            class="flex h-full max-h-[380px] w-full max-w-[250px] flex-col items-center justify-center gap-3 px-2 text-center"
          >
            <img src={why.src} alt="" class="h-[80px] w-[80px]" />
            <figcaption>
              <h1 class="text-base">{why.header}</h1>
              <p class="mt-1 text-sm">
                {why.subText}
              </p>
            </figcaption>
          </figure>
        {/each}
      </div>
    </div>

    <div class="mt-10 px-[10%] py-10">
      <h1 class="mb-28 flex items-center justify-center gap-3 text-center text-3xl">
        {$t('teach.steps_heading')} <img src="/assets/assets/www/teach/thumbs-up.svg" alt="" />
      </h1>

      <div class="mx-auto mt-5 flex flex-wrap justify-between gap-y-10">
        {#each steps as step, i}
          <div class="px-10 py-5 lg:max-w-[40%]">
            <h1 class="text-2xl">
              <span class="mr-3 rounded-md bg-[#F7F7F7] px-2 py-1">{i + 1}</span>
              {step.title}
            </h1>
            <p class="mt-5 text-base text-gray-600">
              {step.subText}
            </p>
          </div>
        {/each}
      </div>
      <div class="mt-3 flex justify-center px-[5%]">
        <Button href="/teach/register" target="_blank" rel="noopener noreferrer nofollow"
          >{$t('teach.get_started')}</Button
        >
      </div>
    </div>

    <div class="mx-auto my-10 mt-10 px-10 lg:max-w-[65%] lg:px-[15%]">
      <h1 class="text-center text-xl">{$t('teach.faq_heading')}</h1>

      <div class="mt-10">
        <Accordion.Root type="single" class="w-full">
          {#each faqs as faq}
            <Accordion.Item value={faq.value}>
              <Accordion.Trigger class="text-left md:text-center">
                {faq.question}
              </Accordion.Trigger>
              <Accordion.Content>
                {faq.answer}
              </Accordion.Content>
            </Accordion.Item>
          {/each}
        </Accordion.Root>
      </div>
    </div>

    <PageSignupCTA
      header={$t('teach.cta_header')}
      subText={$t('teach.cta_subtext')}
      btnLabel={$t('teach.register')}
      link="/teach/register"
      demo={false}
    />
  </div>
</section>
