import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // The admin app is internal and reached only through its own proxy, so no
    // Content-Security-Policy juggling is needed the way the tenant-facing
    // dashboard requires.
    alias: {
      $lib: './src/lib'
    }
  }
};

export default config;
