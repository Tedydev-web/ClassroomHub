<script>
  import {
    Hero,
    RoiBand,
    AiBuildsSection,
    FeaturesSection,
    AiTutorSection,
    AutomationBand,
    MultiAcademySection,
    PageSignupCTA
  } from '$lib/components';
  import { page } from '$app/state';
  import { pathInLocale, t } from '$lib/i18n';
</script>

<Hero />

<RoiBand />

<AiBuildsSection />

<FeaturesSection />

<AiTutorSection
  accent=""
  title={$t('home.tutor_title')}
  description={$t('home.tutor_description')}
  ctaLabel={$t('home.tutor_cta')}
  ctaHref={pathInLocale('/customer-education', page.data.locale)}
  vimeoVideoId="1192910311"
/>

<AutomationBand />

<MultiAcademySection />

<PageSignupCTA header={$t('home.cta_header')} subText={$t('home.cta_subtext')} btnLabel={$t('hero.book_demo')} />
