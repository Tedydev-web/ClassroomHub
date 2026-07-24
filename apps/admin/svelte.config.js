import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $lib: './src/lib'
    },
    csrf: {
      // The app is reachable only inside the operator's tailnet and every action
      // is password-gated, so a cross-site POST is not a reachable threat. The
      // origin check is off so actions work whether the operator reaches the app
      // by its Tailscale IP or its MagicDNS name — otherwise POSTs 403 on a host
      // that does not match the configured ORIGIN.
      checkOrigin: false
    }
  }
};

export default config;
