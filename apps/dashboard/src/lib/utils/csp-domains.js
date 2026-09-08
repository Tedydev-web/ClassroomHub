// SaaS default CSP domains, baked in at build time.
// Self-hosted (adapter-node) starts with empty lists; runtime domains
// are added via env vars in hooks.server.ts so pre-built Docker images stay configurable.
//
// The product's own hosts are written out here rather than imported from
// `@cio/utils`. This module is loaded by `svelte-kit sync`, which runs from the
// `prepare` script during `pnpm install` — before any workspace package has been
// built — so an import of `@cio/utils/dist` fails the install itself.
// `csp.test.ts` compares these against `PRODUCT_HOSTS` instead, where the built
// package is available.
//
// They had been written out as an alias domain: `script-src` and `style-src`
// allowed only `*.tedydev.io.vn`, and neither directive has anything added from
// the environment, so an asset served from the product's own `assets.` or
// `embed.` host was blocked by the browser. The alias entries stay until
// published content stops pointing at them.
const ownHosts = {
  assets: 'https://assets.classroom.io.vn',
  embed: 'https://embed.classroom.io.vn',
  api: 'https://api.classroom.io.vn',
  root: 'https://classroom.io.vn',
  tenants: 'https://*.classroom.io.vn',
  tenantSockets: 'wss://*.classroom.io.vn'
};

const saasDefaults = {
  scriptSrc: [
    ownHosts.assets,
    ownHosts.embed,
    'https://classroom-assets.tedydev.io.vn',
    'https://classroom-embed.tedydev.io.vn',
    'https://cdnjs.cloudflare.com',
    'https://cdn.userjot.com',
    'https://*.posthog.com',
    'https://*.senja.io',
    // Optional analytics origins are appended from deployment environment variables.
    'https://www.youtube.com',
    'https://youtube.com',
    'https://google.com',
    'https://apis.google.com',
    'https://accounts.google.com'
  ],
  styleSrc: [
    'https://cdn.plyr.io',
    'https://unpkg.com/katex@0.12.0/dist/katex.min.css',
    `${ownHosts.assets}/eqneditor_1.css`,
    'https://classroom-assets.tedydev.io.vn/eqneditor_1.css',
    'https://fonts.googleapis.com'
  ],
  connectSrc: [
    ownHosts.tenants,
    ownHosts.root,
    ownHosts.tenantSockets,
    ownHosts.assets,
    ownHosts.api,
    'https://*.classroom.tedydev.io.vn',
    'https://classroom.tedydev.io.vn',
    'wss://*.classroom.tedydev.io.vn',
    'https://classroom-assets.tedydev.io.vn',
    'https://cdn.plyr.io',
    'https://widget.userjot.com',
    'https://*.posthog.com',
    // Optional analytics origins are appended from deployment environment variables.
    'https://*.r2.cloudflarestorage.com',
    'https://*.senja.io',
    'https://*.ytimg.com',
    'https://noembed.com',
    'https://www.googleapis.com'
    // Sentry origins are appended only when this deployment configures a DSN.
  ],
  frameSrc: [
    'https://www.youtube.com',
    'https://youtube.com',
    'https://www.youtube-nocookie.com',
    'https://www.google.com',
    'https://google.com',
    'https://drive.google.com',
    'https://docs.google.com',
    'https://widget.userjot.com'
  ],
  fontSrc: ['https://fonts.gstatic.com', 'https://cdn.plyr.io'],
  mediaSrc: ['https:']
};

/**
 * @param {boolean} isSelfHosted
 * @param {string | undefined} serverUrl - PUBLIC_SERVER_URL, added to connect-src for SaaS builds
 */
export function getCspDomains(isSelfHosted, serverUrl) {
  if (isSelfHosted) {
    return {
      scriptSrc: [],
      styleSrc: [],
      connectSrc: [],
      frameSrc: [],
      fontSrc: [],
      mediaSrc: [],
      apiOrigin: null
    };
  }

  return {
    ...saasDefaults,
    apiOrigin: serverUrl ?? null
  };
}
