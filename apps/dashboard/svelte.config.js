import 'dotenv/config';

import adapterNode from '@sveltejs/adapter-node';
import { getCspDomains } from './src/lib/utils/csp-domains.js';
import path from 'path';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const IS_CLOUDFLARE = process.env.CI_ENVIRONMENT === 'cloudflare';

const adapterCloudflare = IS_CLOUDFLARE ? (await import('@sveltejs/adapter-cloudflare')).default : null;
const isSelfHosted = process.env.PUBLIC_IS_SELFHOSTED === 'true';
const csp = getCspDomains(isSelfHosted, process.env.PUBLIC_SERVER_URL);

const { NODE_ENV: nodeEnvironment } = process['env'];
const useWorkspaceSourceAliases = nodeEnvironment !== 'production';
const utilsPackagePath = path.resolve(
  useWorkspaceSourceAliases ? '../../packages/utils/src' : './node_modules/@cio/utils/dist'
);
const questionTypesPackagePath = path.resolve(
  useWorkspaceSourceAliases ? '../../packages/question-types/src' : './node_modules/@cio/question-types/dist'
);
const SVELTE_EVENT_REPLAY_HASH = 'sha256-7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I=';

// `upgrade-insecure-requests` forces the browser to fetch every subresource over
// HTTPS. Production is always served over HTTPS (Cloudflare), so it belongs there.
// In local dev the server speaks plain HTTP, and the directive is silently ignored
// on `localhost` (a secure context) but breaks any non-localhost host — e.g.
// opening the dev server over a LAN/Tailscale IP upgrades assets to https:// and
// fails with ERR_SSL_PROTOCOL_ERROR. Gate it to production builds only.
const upgradeInsecureRequests = process.env.NODE_ENV === 'production';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({})],
  kit: {
    version: {
      pollInterval: 60_000
    },
    // Default: Node server (Render, Docker). Opt into Cloudflare Pages only when CI_ENVIRONMENT=cloudflare.
    adapter: IS_CLOUDFLARE ? adapterCloudflare() : adapterNode(),
    alias: {
      $lib: path.resolve('./src/lib'),
      $features: path.resolve('./src/lib/features'),
      $mail: path.resolve('./src/mail'),
      '$src/tools': path.resolve('./node_modules/@cio/ui/src/tools/index.ts'),
      '$src/base/*': path.resolve('./node_modules/@cio/ui/src/base'),
      '@cio/ui': path.resolve('./node_modules/@cio/ui/src'),
      '@cio/ui/*': path.resolve('./node_modules/@cio/ui/src'),
      '@cio/api': path.resolve('./node_modules/@cio/api/dist'),
      '@cio/api/*': path.resolve('./node_modules/@cio/api/dist'),
      '@cio/utils': utilsPackagePath,
      '@cio/utils/*': utilsPackagePath,
      '@cio/question-types': questionTypesPackagePath,
      '@cio/question-types/*': questionTypesPackagePath,
      '@cio/db/types': path.resolve('./node_modules/@cio/db/src/types.ts')
    },
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self', ...csp.scriptSrc, 'unsafe-hashes', SVELTE_EVENT_REPLAY_HASH, 'unsafe-eval'],
        'style-src': ['self', 'unsafe-inline', ...csp.styleSrc],
        'style-src-elem': ['self', 'unsafe-inline', ...csp.styleSrc],
        'font-src': ['self', 'data:', ...csp.fontSrc],
        'img-src': ['self', 'data:', ...csp.mediaSrc, 'blob:', 'http://localhost:8004'],
        'media-src': [
          'self',
          ...csp.mediaSrc,
          'data:',
          'blob:',
          'http://localhost:8004',
          ...(csp.apiOrigin ? [csp.apiOrigin] : [])
        ],
        'frame-src': ['self', ...csp.frameSrc],
        'connect-src': [
          'self',
          'blob:',
          'http://localhost:8001',
          'http://localhost:8004',
          ...(csp.apiOrigin ? [csp.apiOrigin] : []),
          ...csp.connectSrc
        ],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        // 'self' allows same-origin iframes (e.g. widget preview at /widget-preview). 'none' blocks all embedding.
        'frame-ancestors': ['self'],
        // Only present in production — SvelteKit emits this boolean directive
        // whenever the key exists, so it must be omitted entirely in dev.
        ...(upgradeInsecureRequests ? { 'upgrade-insecure-requests': true } : {})
      },
      reportOnly: {
        'default-src': ['self'],
        'script-src': ['self', ...csp.scriptSrc, 'unsafe-hashes', SVELTE_EVENT_REPLAY_HASH, 'unsafe-eval'],
        'style-src': ['self', 'unsafe-inline', ...csp.styleSrc],
        'style-src-elem': ['self', 'unsafe-inline', ...csp.styleSrc],
        'font-src': ['self', 'data:', ...csp.fontSrc],
        'img-src': ['self', 'data:', ...csp.mediaSrc, 'blob:', 'http://localhost:8004'],
        'media-src': [
          'self',
          ...csp.mediaSrc,
          'data:',
          'blob:',
          'http://localhost:8004',
          ...(csp.apiOrigin ? [csp.apiOrigin] : [])
        ],
        'frame-src': ['self', ...csp.frameSrc],
        'connect-src': [
          'self',
          'blob:',
          'http://localhost:8001',
          'http://localhost:8004',
          ...(csp.apiOrigin ? [csp.apiOrigin] : []),
          ...csp.connectSrc
        ],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'frame-ancestors': ['self'],
        'report-uri': ['/csp-report']
      }
    }
  }
};

export default config;
