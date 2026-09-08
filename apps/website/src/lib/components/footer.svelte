<script lang="ts">
  import { page } from '$app/state';
  import { CONTACT, PRODUCT_URLS } from '@cio/utils/constants';
  import { DEFAULT_LOCALE, pathInLocale, t, type Locale } from '$lib/i18n';

  let locale = $derived((page.data.locale ?? DEFAULT_LOCALE) as Locale);

  /** Internal paths follow the language being read; the rest are absolute already. */
  function localHref(path: string): string {
    return path.startsWith('/') && !path.startsWith('//') ? pathInLocale(path, locale) : path;
  }

  /*
    The four columns as data. Written out as markup they were 110 lines of
    near-identical anchors, which is how the OSS Friends link survived a rebrand
    unnoticed. Paths under `(redirects)` — /privacy, /tos, /roadmap — are not
    translated pages, so they keep their bare path.
  */
  /*
    Reaching a human. The addresses and numbers come from `@cio/utils` so the
    footer, the help centre and transactional email cannot drift apart.
  */
  const contactChannels = $derived([
    { label: CONTACT.email, href: `mailto:${CONTACT.email}` },
    { label: `Zalo · ${CONTACT.phoneDisplay}`, href: CONTACT.zalo, external: true },
    { label: `Telegram · ${CONTACT.telegramHandle}`, href: CONTACT.telegram, external: true },
    { label: $t('footer.facebook'), href: CONTACT.facebook, external: true },
    { label: CONTACT.phoneDisplay, href: `tel:${CONTACT.phoneDial}` }
  ]);

  const columns = $derived([
    {
      heading: $t('footer.product'),
      links: [
        { label: $t('footer.mcp_recipes'), href: localHref('/mcp-recipes') },
        { label: $t('footer.api_mcp'), href: localHref('/automation') },
        { label: $t('footer.pricing'), href: localHref('/pricing') }
      ]
    },
    {
      heading: $t('footer.solutions'),
      links: [
        { label: $t('footer.customer_education'), href: localHref('/customer-education') },
        { label: $t('footer.compliance_training'), href: localHref('/compliance-training') },
        { label: $t('footer.partner_training'), href: localHref('/partner-training') }
      ]
    },
    {
      heading: $t('footer.resources'),
      links: [
        { label: $t('footer.docs_vs_academy'), href: localHref('/docs-vs-company-academy') },
        { label: $t('footer.public_courses'), href: localHref('/public-courses') },
        { label: $t('footer.teach'), href: localHref('/teach') },
        { label: $t('footer.help_center'), href: PRODUCT_URLS.help, external: true },
        { label: $t('footer.getting_started'), href: PRODUCT_URLS.docs, external: true }
      ]
    },
    {
      heading: $t('footer.company'),
      links: [
        { label: $t('footer.roadmap'), href: '/roadmap' },
        { label: $t('footer.support'), href: `mailto:${CONTACT.email}` },
        { label: $t('footer.privacy'), href: localHref('/privacy') },
        { label: $t('footer.terms'), href: localHref('/tos') }
      ]
    }
  ]);
</script>

<footer
  class="ui:border-border relative overflow-hidden border-t bg-[linear-gradient(to_top,#eef3fb_0%,#f8fafc_100%)] px-[5%] py-12 lg:px-[10%]"
>
  <!-- Minor cloud, top-left, smaller than the hero -->
  <svg
    class="pointer-events-none absolute -top-4 left-3 z-[2] h-12 w-[160px] md:-top-5 md:left-4 md:h-16 md:w-[210px] lg:-top-6 lg:h-20 lg:w-[260px]"
    viewBox="0 0 240 110"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M 22 80
         C 22 60, 42 50, 62 56
         C 68 36, 100 30, 116 52
         C 130 32, 168 38, 174 60
         C 196 56, 216 68, 214 82
         C 214 96, 196 102, 174 96
         C 164 106, 130 106, 120 96
         C 110 106, 78 106, 66 94
         C 46 100, 22 96, 22 80 Z"
      fill="white"
      stroke="#94a3b8"
      stroke-width="1.5"
    />
  </svg>

  <!-- Second smaller cloud, offset right -->
  <svg
    class="pointer-events-none absolute top-3 left-32 z-[2] h-9 w-[110px] md:top-4 md:left-44 md:h-12 md:w-[140px] lg:top-6 lg:left-[200px] lg:h-14 lg:w-[180px]"
    viewBox="0 0 200 90"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M 16 64
         C 16 48, 34 40, 52 46
         C 58 30, 86 26, 100 44
         C 114 28, 144 34, 150 52
         C 168 48, 184 58, 182 70
         C 182 82, 168 86, 150 82
         C 142 90, 114 90, 106 82
         C 98 90, 70 90, 60 80
         C 42 86, 16 82, 16 64 Z"
      fill="white"
      stroke="#94a3b8"
      stroke-width="1.5"
    />
  </svg>

  <div class="relative z-10 flex flex-col gap-10 lg:flex-row lg:justify-between">
    <!-- Brand -->
    <div class="flex flex-col gap-4 lg:max-w-[220px]">
      <img width="32" height="32" loading="lazy" src="/logo-192.png" alt="ClassroomHub logo" />
      <p class="ui:text-muted-foreground text-sm leading-6">{$t('footer.tagline')}</p>

      <!--
        Contact sits with the brand rather than as a fifth nav column: these are
        ways to reach a person, not places on this site. Zalo first after email,
        because it is the channel most Vietnamese visitors will actually use.
      -->
      <div class="mt-1">
        <p class="ui:text-foreground mb-2.5 text-sm font-semibold">{$t('footer.contact')}</p>
        <ul class="space-y-2">
          {#each contactChannels as channel}
            <li>
              <a
                href={channel.href}
                target={channel.external ? '_blank' : undefined}
                rel={channel.external ? 'noopener' : undefined}
                class="ui:text-muted-foreground ui:hover:text-foreground text-sm transition-colors">{channel.label}</a
              >
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <!-- Nav columns -->
    <nav class="grid grid-cols-2 gap-8 sm:grid-cols-4">
      {#each columns as column}
        <div>
          <p class="ui:text-foreground mb-4 text-sm font-semibold">{column.heading}</p>
          <ul class="space-y-3">
            {#each column.links as link}
              <li>
                <a
                  href={link.href}
                  target={link.external ? '_blank' : undefined}
                  rel={link.external ? 'noopener' : undefined}
                  class="ui:text-muted-foreground ui:hover:text-foreground text-sm transition-colors">{link.label}</a
                >
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </nav>
  </div>

  <div
    class="ui:border-border ui:text-muted-foreground relative z-10 mt-10 border-t pt-6 text-center text-xs lg:text-left"
  >
    {$t('footer.rights', { year: new Date().getFullYear() })}
  </div>
</footer>
