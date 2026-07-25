<script lang="ts">
  import { cn } from '$src/tools';
  import commands from '../commands/toolbar-commands';
  import type { EdraToolbarProps } from '../types';
  import Alignment from './components/toolbar/Alignment.svelte';
  import FontSize from './components/toolbar/FontSize.svelte';
  import Headings from './components/toolbar/Headings.svelte';
  import QuickColors from './components/toolbar/QuickColors.svelte';
  import SearchAndReplace from './components/toolbar/SearchAndReplace.svelte';
  import ToolBarIcon from './components/ToolBarIcon.svelte';

  const { editor, class: className, excludedCommands, children, trailing }: EdraToolbarProps = $props();

  // Exclusions match either a whole group ('media') or a single command
  // ('bold'), so a variant can drop one button without listing the rest.
  const isExcluded = (name: string) => excludedCommands?.includes(name) ?? false;

  const toolbarCommands = $derived(
    Object.keys(commands)
      .filter((group) => !isExcluded(group))
      // A group whose commands are all excluded would render as an empty gap.
      .filter((group) => commands[group].some((command) => !isExcluded(command.name)))
  );
</script>

<div class={cn('edra-toolbar', className)}>
  {#if children}
    {@render children()}
  {:else}
    {#each toolbarCommands as cmd (cmd)}
      {#if cmd === 'headings'}
        <Headings {editor} />
      {:else if cmd === 'alignment'}
        <Alignment {editor} />
      {:else}
        {@const commandGroup = commands[cmd].filter((command) => !isExcluded(command.name))}
        <!-- Keyed by identity, not name: the maths group registers two entries
             under the same `mathematics` name (inline and block). -->
        {#each commandGroup as command (command)}
          <ToolBarIcon {editor} {command} />
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

  {#if trailing}
    <div class="ui:ml-auto ui:flex ui:shrink-0 ui:items-center ui:pl-1">
      {@render trailing()}
    </div>
  {/if}
</div>
