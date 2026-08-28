<script lang="ts">
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import LanguagesIcon from '@lucide/svelte/icons/languages';
  import type { TLocale } from '@cio/db/types';

  import { LANGUAGES } from '$lib/utils/constants/translation';
  import { t, locale, handleLocaleChange } from '$lib/utils/functions/translations';

  /**
   * Changing language on a screen that has no sidebar.
   *
   * The only switcher used to live in the app sidebar's profile menu, which exists for
   * signed-in people on the app routes and nowhere else. Everybody else — somebody signing
   * in, somebody following an invite, somebody browsing a public course, and a candidate
   * sitting an exam with no account at all — had the language chosen for them by a cookie
   * they never set.
   *
   * It is the same choice the sidebar offers, from the same list, persisted the same way, so
   * a person who switches here and later signs in finds the app already in their language.
   *
   * The name of the current language is hidden on a narrow screen and the globe stands in.
   * That is not decoration: on the exam header this sits beside a running clock, and the
   * clock does not give up room.
   */
  let {
    /** Matches the surface it is dropped into; ghost for chrome, outline when it stands alone. */
    variant = 'ghost',
    align = 'end'
  }: {
    variant?: 'ghost' | 'outline';
    align?: 'start' | 'center' | 'end';
  } = $props();

  const current = $derived(
    LANGUAGES.find((language) => language.id === $locale) ?? LANGUAGES.find((language) => language.id === 'en')
  );

  function choose(value: string) {
    if (value && value !== $locale) {
      handleLocaleChange(value as TLocale);
    }
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={[
      'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-9 min-h-9 items-center gap-2 rounded-md px-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
      variant === 'outline' ? 'border-input bg-background border' : ''
    ]}
    aria-label={$t('profileMenu.language')}
  >
    <LanguagesIcon size={16} />
    <span class="hidden sm:inline">{current?.native}</span>
  </DropdownMenu.Trigger>

  <DropdownMenu.Content {align} class="max-h-72 overflow-y-auto">
    <DropdownMenu.RadioGroup value={$locale} onValueChange={choose}>
      {#each LANGUAGES as language (language.id)}
        <DropdownMenu.RadioItem value={language.id} class="text-sm">
          <!--
            Each option reads in its own language, with the English name behind it. Somebody
            who cannot read the current interface can still find their own row.
          -->
          <span class="flex-1">{language.native}</span>
          <span class="text-muted-foreground text-xs">{language.text}</span>
        </DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
