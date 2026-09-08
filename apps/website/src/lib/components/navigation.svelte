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

  const solutions: NavCollectionItem[] = [
    {
      key: 'customer-education',
      title: 'Customer Education',
      subtitle: 'Customer academies for SaaS.',
      href: '/customer-education'
    },
    {
      key: 'compliance-training',
      title: 'Compliance Training',
      subtitle: 'Turn policies and SOPs into proof.',
      href: '/compliance-training'
    },
    {
      key: 'partner-training',
      title: 'Partner Training',
      subtitle: 'A separate academy for your channel.',
      href: '/partner-training'
    },
    {
      key: 'public-courses',
      title: 'Public Courses',
      subtitle: 'Sell courses to learners anywhere.',
      href: '/public-courses'
    },
    {
      key: 'teach',
      title: 'Teach with us',
      subtitle: 'Bring your own programme to the platform.',
      href: '/teach'
    }
  ];

  const developers: NavCollectionItem[] = [
    {
      key: 'automation',
      title: 'Automation',
      subtitle: 'API, Webhooks, and MCP server.',
      href: '/automation'
    },
    {
      key: 'docs',
      title: 'Documentation',
      subtitle: 'API reference and integration guides.',
      href: 'https://classroom.tedydev.io.vn/docs'
    },
    {
      key: 'help',
      title: 'Help Center',
      subtitle: 'Guides for running your academy.',
      href: 'https://classroom.tedydev.io.vn/help'
    },
    {
      key: 'mcp-recipes',
      title: 'MCP Recipes',
      subtitle: 'Ready-to-run agent prompts.',
      href: '/mcp-recipes'
    },
    {
      key: 'storybook',
      title: 'Storybook',
      subtitle: 'Browse and reuse UI components.',
      href: 'https://classroom.tedydev.io.vn'
    }
  ];

  const navItems: NavItem[] = [
    {
      key: 'solutions',
      title: 'Solutions',
      href: '/',
      items: solutions
    },
    {
      key: 'developers',
      title: 'Developers',
      href: '/automation',
      items: developers
    },
    {
      key: 'pricing',
      title: 'Pricing',
      href: '/pricing'
    }
  ];

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
    <a href="/" class="shrink-0" aria-label="ClassroomHub home">
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
      <a
        class="text-sm font-medium transition-opacity duration-200 after:ml-2 after:content-['→'] hover:opacity-80"
        href="https://classroom-app.tedydev.io.vn"
      >
        Dashboard
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
            Dashboard
          </a>
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
