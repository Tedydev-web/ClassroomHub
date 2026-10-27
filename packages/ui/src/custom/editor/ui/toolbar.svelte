<script lang="ts">
  import { cn } from '$src/tools';
  import commands from '../commands/toolbar-commands';
  import type { EdraToolbarProps } from '../types';
  import Alignment from './components/toolbar/Alignment.svelte';
  import FontSize from './components/toolbar/FontSize.svelte';
  import CalloutMenu from './components/toolbar/callout.svelte';
  import Headings from './components/toolbar/Headings.svelte';
  import QuickColors from './components/toolbar/QuickColors.svelte';
  import SearchAndReplace from './components/toolbar/SearchAndReplace.svelte';
  import ToolBarIcon from './components/ToolBarIcon.svelte';

  const {
    editor,
    class: className,
    excludedCommands,
    children,
    trailing,
    preset = 'default',
    trailingContent
  }: EdraToolbarProps = $props();

  // Exclusions match either a whole group ('media') or a single command
  // ('bold'), so a variant can drop one button without listing the rest.
  const isExcluded = (name: string) => excludedCommands?.includes(name) ?? false;

  const toolbarCommands = $derived(
    Object.keys(commands)
      .filter((group) => !isExcluded(group))
      // A group whose commands are all excluded would render as an empty gap.
      .filter((group) => commands[group].some((command) => !isExcluded(command.name)))
  );

  // The email preset keeps only what survives in an email client.
  const emailFormatting = commands['text-formatting'].filter((command) =>
    ['bold', 'italic', 'underline', 'link'].includes(command.name)
  );
  const emailLists = commands.lists.filter((command) => ['bulletList', 'orderedList'].includes(command.name));
  const emailImages = commands.media.filter((command) => command.name === 'image-placeholder');
</script>

<div class={cn('edra-toolbar ui:flex ui:min-w-0 ui:items-center', className)}>
  <!-- Only the command strip scrolls. Persistent actions such as fullscreen
       remain visible at the right edge even when the toolbar overflows. -->
  <div class="ui:flex ui:min-w-0 ui:flex-1 ui:items-center ui:overflow-x-auto">
    {#if children}
      {@render children()}
    {:else if preset === 'email'}
      {#each emailFormatting as command (command.name)}
        <ToolBarIcon {editor} {command} />
      {/each}
      <Headings {editor} />
      {#each emailLists as command (command.name)}
        <ToolBarIcon {editor} {command} />
      {/each}
      {#each emailImages as command (command.name)}
        <ToolBarIcon {editor} {command} />
      {/each}
      <Alignment {editor} />
      {@render trailingContent?.()}
    {:else}
      {#each toolbarCommands as cmd (cmd)}
        {#if cmd === 'headings'}
          <Headings {editor} />
        {:else if cmd === 'alignment'}
          <Alignment {editor} />
        {:else}
          {@const commandGroup = commands[cmd].filter(
            (command) => !isExcluded(command.name) && command.name !== 'audio-placeholder'
          )}
          <!-- Keyed by identity, not name: the maths group registers two entries
               under the same `mathematics` name (inline and block). -->
          {#each commandGroup as command (command)}
            <ToolBarIcon {editor} {command} />
            {#if command.name === 'blockQuote' && !isExcluded('callout')}
              <CalloutMenu {editor} />
            {/if}
          {/each}
        {/if}
      {/each}
      {#if !isExcluded('font-size')}
        <FontSize {editor} />
      {/if}
      {#if !isExcluded('quick-colors')}
        <QuickColors {editor} />
      {/if}
      {#if !isExcluded('search-replace')}
        <SearchAndReplace {editor} />
      {/if}
    {/if}
  </div>

  {#if trailing}
    <div class="ui:bg-secondary/95 ui:flex ui:shrink-0 ui:items-center ui:border-l ui:border-dashed ui:pl-1">
      {@render trailing()}
    </div>
  {/if}
</div>
