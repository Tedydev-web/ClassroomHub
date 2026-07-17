<script lang="ts">
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import LanguagesIcon from '@lucide/svelte/icons/languages';
  import type { TLocale } from '@cio/db/types';
  import { LANGUAGES } from '$lib/utils/constants/translation';
  import { t, locale, handleLocaleChange } from '$lib/utils/functions/translations';

  // Reflect the language i18n is actually rendering, falling back to English.
  const currentLanguage = $derived(
    LANGUAGES.find((language) => language.id === $locale) ?? LANGUAGES.find((language) => language.id === 'en')
  );

  function onSelect(value: string) {
    if (value && value !== $locale) {
      handleLocaleChange(value as TLocale);
    }
  }
</script>

<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger class="m-0 gap-2">
    <LanguagesIcon size={16} />
    <span class="flex-1 text-sm">{$t('profileMenu.language')}</span>
    <span class="text-muted-foreground text-xs">{currentLanguage?.native}</span>
  </DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent class="max-h-72 overflow-y-auto">
    <DropdownMenu.RadioGroup value={$locale} onValueChange={onSelect}>
      {#each LANGUAGES as language (language.id)}
        <DropdownMenu.RadioItem value={language.id} class="text-sm">
          <span class="flex-1">{language.native}</span>
          <span class="text-muted-foreground text-xs">{language.text}</span>
        </DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
