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
    unnoticed. /privacy and /tos are translated pages; everything else here is an
    absolute URL or a mailto already.
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
        { label: $t('footer.help_center'), href: PRODUCT_URLS.help, external: true }
      ]
    },
    {
      heading: $t('footer.company'),
      links: [
        { label: $t('footer.support'), href: `mailto:${CONTACT.email}` },
        { label: $t('footer.privacy'), href: localHref('/privacy') },
        { label: $t('footer.terms'), href: localHref('/tos') }
      ]
    }
  ]);
</script>

<footer
  class="ui:border-border relative overflow-hidden border-t bg-[linear-gradient(to_top,#eef3fb_0%,#f8fafc_100%)] px-6 pt-20 pb-10 md:px-10 lg:pt-24"
>
  <div class="max-w-content relative z-10 mx-auto flex flex-col gap-12 lg:flex-row lg:justify-between">
    <!-- Brand -->
    <div class="flex flex-col gap-5 lg:max-w-[280px]">
      <img width="48" height="48" loading="lazy" src="/logo-192.png" alt="ClassroomHub logo" />
      <p class="ui:text-muted-foreground text-[15px] leading-relaxed">{$t('footer.tagline')}</p>

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
    <nav class="grid grid-cols-2 gap-x-12 gap-y-10 sm:grid-cols-4">
      {#each columns as column}
        <div>
          <p class="ui:text-foreground mb-5 text-sm font-semibold">{column.heading}</p>
          <ul class="space-y-3.5">
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

  <div class="max-w-content ui:text-muted-foreground relative z-10 mx-auto mt-16 text-center text-[13px] lg:text-left">
    {$t('footer.rights', { year: new Date().getFullYear() })}
  </div>
</footer>
