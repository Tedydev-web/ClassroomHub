<script lang="ts">
  import { PLANS } from '@cio/utils/plans';
  import { PricingCard } from '@cio/ui/custom/pricing-card';
  import { PricingToggle } from '@cio/ui/custom/pricing-toggle';

  import { PageSignupCTA, PageHeader } from '$lib/components';
  import { t } from '$lib/i18n';
  import { FEATURE_KEYS } from '$lib/i18n/plan-copy';
  import { env } from '$env/dynamic/public';

  let isYearlyPlan = $state(false);

  const planNames = Object.keys(PLANS) as Array<keyof typeof PLANS>;

  /**
   * The plan as the reader's language states it. Everything numeric — price,
   * currency, the product ids the checkout needs — stays exactly as the billing
   * package defines it; only the wording is swapped.
   */
  function translated(planName: keyof typeof PLANS) {
    const plan = PLANS[planName];
    const key = `pricing.plans.${planName}`;

    return {
      ...plan,
      NAME: $t(`${key}.name`),
      DESCRIPTION: $t(`${key}.description`),
      PRICE: {
        ...plan.PRICE,
        ...(planName === 'ENTERPRISE' ? { MONTHLY: $t(`${key}.price`), YEARLY: $t(`${key}.price`) } : {})
      },
      FEATURES: plan.FEATURES.map((feature) => $t(`pricing.features.${FEATURE_KEYS[feature]}`)),
      CTA: { ...plan.CTA, LABEL: $t(`${key}.cta`) }
    };
  }
</script>

<svelte:head>
  <title>{$t('pricing.title')}</title>
</svelte:head>

<section>
  <PageHeader className="flex flex-col items-center justify-center text-center">
    <h1 class="mx-auto flex flex-col items-center text-4xl text-slate-900 md:text-6xl">
      <span>{$t('pricing.heading_lead')}</span>
      <span class="relative text-blue-700">{$t('pricing.heading_accent')}</span>
    </h1>
    <p class="mt-10 w-[90%] text-center text-lg font-normal text-slate-700 md:w-[60%] lg:mt-7">
      {$t('pricing.subhead')}
    </p>
    <div class="mt-8">
      <PricingToggle
        bind:isYearly={isYearlyPlan}
        monthlyLabel={$t('pricing.monthly')}
        yearlyLabel={$t('pricing.yearly')}
        saveLabel={$t('pricing.save')}
      />
    </div>

    {#if env.PUBLIC_IS_SELF_OWNED !== 'true'}
      <script
        src="https://widget.senja.io/widget/b43ac234-427e-4d6f-8c23-633208154e54/platform.js"
        type="text/javascript"
        async
      ></script>
      <div
        class="senja-embed mt-5"
        data-id="b43ac234-427e-4d6f-8c23-633208154e54"
        data-mode="shadow"
        data-lazyload="false"
        style="display: block;"
      ></div>
    {/if}
  </PageHeader>

  <div class="w-full px-2 py-16">
    <div class="mx-auto max-w-7xl">
      <div class="flex w-full flex-wrap justify-evenly gap-2">
        {#each planNames as planName}
          {@const plan = translated(planName)}
          {@const isPopular = planName === 'EARLY_ADOPTER'}

          <PricingCard
            {plan}
            {planName}
            {isPopular}
            {isYearlyPlan}
            className="mx-auto lg:mx-0 w-full max-w-xs! lg:max-w-sm!"
            ctaLabel={plan.CTA.LABEL}
            isDisabled={false}
            perOrgLabel={isYearlyPlan ? $t('pricing.per_year') : $t('pricing.per_month')}
            handleClick={() => {
              if (env.PUBLIC_IS_SELF_OWNED === 'true') {
                window.location.assign('/signup');
                return;
              }

              window.open(plan.CTA.LINK, '_blank');
            }}
          />
        {/each}
      </div>
    </div>
    <p class="mt-6 text-center text-sm text-slate-500">
      {$t('pricing.token_note')}
    </p>
  </div>
</section>

<PageSignupCTA
  header={$t('pricing.cta_header')}
  subText={$t('pricing.cta_subtext')}
  btnLabel={$t('pricing.cta_button')}
  link="/signup"
  demo={false}
/>
