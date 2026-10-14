<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div
  aria-hidden="true"
  class="ui:pointer-events-none ui:fixed ui:inset-0 ui:z-10 ui:grid ui:select-none ui:grid-cols-2 ui:place-items-center ui:overflow-hidden ui:sm:grid-cols-3 print:hidden"
>
  {#each Array.from({ length: 18 }, (_, index) => index) as index (index)}
    <span
      class="ui:whitespace-nowrap ui:text-sm ui:font-semibold -rotate-[24deg] text-black/[0.07] dark:text-white/[0.07]"
      >{text}</span
    >
  {/each}
</div>
