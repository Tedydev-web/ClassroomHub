<script lang="ts">
  import { PLANS } from '@cio/utils/plans';
  import { PricingToggle } from '@cio/ui/custom/pricing-toggle';

  import { PageSignupCTA, PageHeader, PricingPlanCard } from '$lib/components';
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
      // A self-owned install has no hosted checkout to send the reader to.
      CTA: {
        ...plan.CTA,
        LABEL: $t(`${key}.cta`),
        LINK: env.PUBLIC_IS_SELF_OWNED === 'true' ? '/signup' : plan.CTA.LINK
      }
    };
  }
</script>

<svelte:head>
  <title>{$t('pricing.title')}</title>
</svelte:head>

<section>
  <PageHeader className="max-w-content mx-auto flex flex-col items-center px-6 text-center md:px-10 xl:px-0">
    <h1 class="text-title flex flex-col items-center font-medium text-slate-900 lg:text-[64px]">
      <span>{$t('pricing.heading_lead')}</span>
      <span class="relative text-blue-700">{$t('pricing.heading_accent')}</span>
    </h1>
    <p class="text-lead mt-6 max-w-[580px] text-slate-700">
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
        class="senja-embed mt-10"
        data-id="b43ac234-427e-4d6f-8c23-633208154e54"
        data-mode="shadow"
        data-lazyload="false"
        style="display: block;"
      ></div>
    {/if}
  </PageHeader>

  <div class="w-full px-6 py-20 md:px-10">
    <div class="max-w-content mx-auto">
      <div class="mx-auto grid max-w-sm gap-6 lg:max-w-none lg:grid-cols-3">
        {#each planNames as planName (planName)}
          <PricingPlanCard
            plan={translated(planName)}
            isPopular={planName === 'EARLY_ADOPTER'}
            {isYearlyPlan}
            perOrgLabel={isYearlyPlan ? $t('pricing.per_year') : $t('pricing.per_month')}
            popularLabel={$t('pricing.popular')}
            featuresLabel={$t('pricing.included')}
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
