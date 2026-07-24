<script>
  import { PageSignupCTA } from '$lib/components';
  /**
   * @typedef {Object} Props
   * @property {import('svelte').Snippet} [children]
   */

  /** @type {Props} */
  let { children } = $props();
</script>

<svelte:head>
  <title>Free Tools | ClassroomHub</title>
  <meta property="og:image" itemprop="image" content="/assets/brand/og/free-tools.png" />
  <meta property="og:title" content="ClassroomHub Free Tools" />
  <meta
    property="og:description"
    content="At ClassroomHub, we have built a suit of tools for anyone to use freely while collaborating with students"
  />

  <meta property="og:image:secure_url" itemprop="image" content="/assets/brand/og/free-tools.png" />

  <meta name="twitter:title" content="ClassroomHub Free Tools" />
  <meta
    name="twitter:description"
    content="At ClassroomHub, we have built a suit of tools for anyone to use freely while collaborating with students"
  />
  <meta name="twitter:image" content="/assets/brand/og/free-tools.png" />
</svelte:head>

{@render children?.()}

<PageSignupCTA
  header="Stop forwarding help articles."
  subText="Launch a branded academy on your domain in days."
  btnLabel="Book a Demo"
/>
