<script lang="ts">
  import BookOpen from '@lucide/svelte/icons/book-open';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Globe from '@lucide/svelte/icons/globe';
  import GraduationCap from '@lucide/svelte/icons/graduation-cap';
  import LocateFixed from '@lucide/svelte/icons/locate-fixed';
  import Menu from '@lucide/svelte/icons/menu';
  import MessagesSquare from '@lucide/svelte/icons/messages-square';
  import Server from '@lucide/svelte/icons/server';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Webhook from '@lucide/svelte/icons/webhook';
  import X from '@lucide/svelte/icons/x';
  import { page } from '$app/state';
  import { DEFAULT_LOCALE, LOCALE_COOKIE, pathInLocale, t, type Locale } from '$lib/i18n';
  import { fly } from 'svelte/transition';
  import type { HTMLAttributes } from 'svelte/elements';
  import * as NavigationMenu from '@cio/ui/base/navigation-menu';
  import LibraryBigIcon from '@lucide/svelte/icons/library-big';
  import { cn } from '@cio/ui/tools';

  type ListItemProps = HTMLAttributes<HTMLAnchorElement> & {
    title: string;
    href: string;
    subtitle: string;
    key: string;
  };

  type NavCollectionItem = {
    key: string;
    title: string;
    subtitle: string;
    href: string;
  };

  type NavItem = {
    key: string;
    title: string;
    href?: string;
    items?: NavCollectionItem[];
  };

  let expandedMobileGroup = $state<string | null>(null);
  let showSolutions = $state(false);
  let activeLink = $derived(page.url.pathname);
  let locale = $derived((page.data.locale ?? DEFAULT_LOCALE) as Locale);

  /** An internal path in the language being read; external URLs pass through. */
  function localHref(path: string): string {
    return path.startsWith('http') ? path : pathInLocale(path, locale);
  }

  /**
   * Switching language keeps the visitor on the page they are reading and records the
   * choice, which is what stops the next visit from being guessed at again. The key is
   * the one the dashboard reads, so the two halves of the product never disagree.
   *
   * A real link, not a button: it is how the prerenderer discovers the other language
   * tree at build time, and it lets a reader open the translation in a new tab.
   */
  function remember(target: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
  }

  function handleMobileGroupToggle(groupKey: string) {
    expandedMobileGroup = expandedMobileGroup === groupKey ? null : groupKey;
  }

  function handleShowSolutions() {
    showSolutions = !showSolutions;

    if (!showSolutions) {
      expandedMobileGroup = null;
    }
  }

  function closeMobileMenu() {
    showSolutions = false;
    expandedMobileGroup = null;
  }

  /** The translated wording for one menu entry. */
  function item(key: string): { title: string; subtitle: string } {
    return { title: $t(`nav.items.${key}.title`), subtitle: $t(`nav.items.${key}.subtitle`) };
  }

  const solutions: NavCollectionItem[] = $derived([
    { key: 'customer-education', href: localHref('/customer-education'), ...item('customer_education') },
    { key: 'compliance-training', href: localHref('/compliance-training'), ...item('compliance_training') },
    { key: 'partner-training', href: localHref('/partner-training'), ...item('partner_training') },
    { key: 'public-courses', href: localHref('/public-courses'), ...item('public_courses') },
    { key: 'teach', href: localHref('/teach'), ...item('teach') }
  ]);

  const developers: NavCollectionItem[] = $derived([
    { key: 'automation', href: localHref('/automation'), ...item('automation') },
    { key: 'docs', href: 'https://classroom.tedydev.io.vn/docs', ...item('docs') },
    { key: 'help', href: 'https://classroom.tedydev.io.vn/help', ...item('help') },
    { key: 'mcp-recipes', href: localHref('/mcp-recipes'), ...item('mcp_recipes') },
    { key: 'storybook', href: 'https://classroom.tedydev.io.vn', ...item('storybook') }
  ]);

  const navItems: NavItem[] = $derived([
    { key: 'solutions', title: $t('nav.solutions'), href: localHref('/'), items: solutions },
    { key: 'developers', title: $t('nav.developers'), href: localHref('/automation'), items: developers },
    { key: 'pricing', title: $t('nav.pricing'), href: localHref('/pricing') }
  ]);

  let isSolutionsActive = $derived(!!solutions.some((s) => activeLink.includes(s.key)));
  let isDevelopersActive = $derived(!!developers.some((d) => activeLink.includes(d.key)));

  function isNavItemActive(navItem: NavItem) {
    if (navItem.key === 'solutions') {
      return isSolutionsActive;
    }

    if (navItem.key === 'developers') {
      return isDevelopersActive;
    }

    return navItem.href ? activeLink.startsWith(navItem.href) : false;
  }
</script>

{#snippet language_switcher()}
  <div class="flex items-center gap-1 rounded-md border border-gray-200 p-0.5" aria-label={$t('nav.language')}>
    {#each ['vi', 'en'] as const as option}
      <a
        href={pathInLocale(activeLink, option)}
        hreflang={option}
        lang={option}
        aria-current={locale === option}
        class={cn(
          'cursor-pointer rounded px-2 py-1 text-xs font-medium uppercase no-underline transition-colors duration-200',
          locale === option ? 'bg-gray-950 text-white' : 'text-gray-600 hover:bg-gray-100'
        )}
        onclick={() => remember(option)}
      >
        {option}
      </a>
    {/each}
  </div>
{/snippet}

{#snippet list_item({ title, subtitle, href, key, class: className, ...restProps }: ListItemProps)}
  <li>
    <NavigationMenu.Link>
      {#snippet child()}
        <a
          {href}
          class="flex w-full flex-row items-center rounded-lg p-2 no-underline transition-colors duration-200 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none {className} [&_svg]:stroke-blue-600"
          {...restProps}
        >
          <div class="shrink-0">
            {#if key === 'compliance-training'}
              <LibraryBigIcon size={24} />
            {:else if key === 'partner-training'}
              <LocateFixed size={24} />
            {:else if key === 'customer-education'}
              <MessagesSquare size={24} />
            {:else if key === 'public-courses'}
              <Globe size={24} />
            {:else if key === 'teach'}
              <GraduationCap size={24} />
            {:else if key === 'automation'}
              <Webhook size={24} />
            {:else if key === 'docs'}
              <Server size={24} />
            {:else if key === 'help'}
              <BookOpen size={24} />
            {:else if key === 'mcp-recipes'}
              <Sparkles size={24} />
            {/if}
          </div>
          <div class="ml-3 text-start">
            <p class="text-sm">
              {title}
            </p>
            <p class="ui:text-muted-foreground mt-1 text-xs">
              {subtitle}
            </p>
          </div>
        </a>
      {/snippet}
    </NavigationMenu.Link>
  </li>
{/snippet}

<section class="fixed top-0 z-50 w-full border-b bg-white">
  <div class="mx-auto flex w-full items-center justify-between gap-20 px-4 py-1 lg:w-[90%] lg:px-0">
    <a href={localHref('/')} class="shrink-0" aria-label="ClassroomHub home">
      <div class="flex w-full items-center">
        <img loading="lazy" width="124" height="32" src="/wordmark.svg" alt="ClassroomHub" class="h-10 w-auto" />
        <h1 class="sr-only">ClassroomHub</h1>
      </div>
    </a>

    <section class="hidden! lg:block!">
      <NavigationMenu.Root class="p-1">
        <NavigationMenu.List class="flex w-full items-center justify-center gap-1">
          {#each navItems as navItem}
            <NavigationMenu.Item>
              {#if navItem.items}
                <NavigationMenu.Trigger
                  class={cn(
                    'flex cursor-pointer items-center rounded-md px-4 py-2 text-sm font-medium text-gray-800 transition-all duration-200 hover:bg-gray-100 data-[state=open]:bg-gray-100',
                    isNavItemActive(navItem) && 'bg-gray-100!'
                  )}
                >
                  <a href={navItem.href} class="no-underline">{navItem.title}</a>
                </NavigationMenu.Trigger>
                <NavigationMenu.Content>
                  <ul class="grid w-[560px] grid-cols-2 gap-2 p-2">
                    {#each navItem.items as item}
                      {@render list_item({
                        href: item.href,
                        title: item.title,
                        subtitle: item.subtitle,
                        key: item.key
                      })}
                    {/each}
                  </ul>
                </NavigationMenu.Content>
              {:else}
                <NavigationMenu.Link>
                  {#snippet child()}
                    <a
                      href={navItem.href}
                      class={cn(
                        'cursor-pointer rounded-md px-4 py-2 text-sm font-medium text-gray-800 no-underline transition-all duration-200 hover:bg-gray-100',
                        isNavItemActive(navItem) && 'bg-gray-100'
                      )}
                    >
                      {navItem.title}
                    </a>
                  {/snippet}
                </NavigationMenu.Link>
              {/if}
            </NavigationMenu.Item>
          {/each}
        </NavigationMenu.List>
      </NavigationMenu.Root>
    </section>

    <div class="hidden! flex-row items-center justify-between gap-3 lg:flex!">
      {@render language_switcher()}
      <a
        class="text-sm font-medium transition-opacity duration-200 after:ml-2 after:content-['→'] hover:opacity-80"
        href="https://classroom-app.tedydev.io.vn"
      >
        {$t('nav.dashboard')}
      </a>
    </div>

    <button type="button" aria-label="Hamburger Menu" class="shrink-0 lg:hidden!" onclick={handleShowSolutions}>
      <Menu size={24} />
    </button>

    {#if showSolutions}
      <div
        in:fly={{ x: 20, duration: 700 }}
        out:fly={{ x: 20, duration: 400 }}
        class="absolute top-0 right-0 h-screen w-[60%] border-2 bg-white px-3 pt-3 pb-2 sm:block md:w-[40%] md:p-7 lg:hidden"
      >
        <div class="mb-5 flex justify-between py-2">
          <img loading="lazy" width="124" height="32" src="/wordmark.svg" alt="ClassroomHub" class="h-10 w-auto" />
          <button class="mr-5" onclick={handleShowSolutions}>
            <X size={24} />
          </button>
        </div>
        <nav>
          <ul class="flex w-full flex-col items-center justify-between lg:flex-row">
            {#each navItems as navItem}
              <li class="w-full cursor-pointer text-sm font-semibold text-gray-800 md:text-lg">
                {#if navItem.items}
                  <button
                    class={cn(
                      'flex w-full items-center justify-between rounded-lg px-4 py-3 transition-all duration-200 hover:bg-gray-100',
                      isNavItemActive(navItem) && 'bg-gray-100'
                    )}
                    onclick={() => {
                      handleMobileGroupToggle(navItem.key);
                    }}
                  >
                    {navItem.title}
                    <ChevronDown />
                  </button>
                  {#if expandedMobileGroup === navItem.key}
                    <div in:fly={{ y: -20, duration: 700 }} out:fly={{ y: 20, duration: 400 }}>
                      {#each navItem.items as item}
                        <a href={item.href} onclick={closeMobileMenu}>
                          <p
                            class="rounded-lg py-2.5 pl-5 text-xs font-normal text-gray-700 transition-colors duration-200 hover:bg-gray-100"
                          >
                            {item.title}
                          </p>
                        </a>
                      {/each}
                    </div>
                  {/if}
                {:else}
                  <a
                    class={cn(
                      'block w-full rounded-md px-4 py-3 text-sm font-semibold text-gray-800 transition-all duration-200 hover:bg-gray-100 md:text-lg',
                      isNavItemActive(navItem) && 'bg-gray-100'
                    )}
                    onclick={closeMobileMenu}
                    href={navItem.href}
                  >
                    {navItem.title}
                  </a>
                {/if}
              </li>
            {/each}
          </ul>
        </nav>
        <div class="mt-5 flex flex-col items-start gap-y-2 border-t pt-5">
          <a
            class="w-full rounded-md px-4 py-4 text-left text-sm font-semibold transition-all duration-200 after:ml-2 after:content-['→'] hover:bg-gray-100 md:text-lg"
            href="https://classroom-app.tedydev.io.vn"
          >
            {$t('nav.dashboard')}
          </a>
          <div class="px-4 py-2">
            {@render language_switcher()}
          </div>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .active {
    background-color: #f3f4f6;
    border-radius: 6px;
  }
</style>
