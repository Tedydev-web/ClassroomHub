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
// They had been written out as an alias domain, so `script-src` and `style-src`
// allowed only that alias — and neither directive takes anything from the
// environment, so an asset served from the product's own `assets.` or `embed.`
// host was blocked by the browser. Nothing is served from the alias any more
// and its entries are gone; a host added here must be one this deployment
// actually serves, or it is an allowance granted to someone else.
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
    'https://fonts.googleapis.com'
  ],
  connectSrc: [
    ownHosts.tenants,
    ownHosts.root,
    ownHosts.tenantSockets,
    ownHosts.assets,
    ownHosts.api,
    'https://cdn.plyr.io',
    'https://widget.userjot.com',
    'https://*.posthog.com',
    // Optional analytics origins are appended from deployment environment variables.
    'https://*.r2.cloudflarestorage.com',
    'https://*.senja.io',
    'https://*.ytimg.com',
    'https://noembed.com',
    'https://www.googleapis.com',
    'https://*.vimeo.com',
    'https://vimeo.com',
    'https://*.vimeocdn.com'
    // Sentry origins are appended only when this deployment configures a DSN.
  ],
  frameSrc: [
    'https://www.youtube.com',
    'https://youtube.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
    'https://*.vimeo.com',
    'https://vimeo.com',
    'https://www.google.com',
    'https://google.com',
    'https://drive.google.com',
    'https://docs.google.com',
    // Slide embed platforms — keep in sync with SLIDE_EMBED_FRAME_SRC_ORIGINS
    // in packages/utils/src/functions/slide-embed.ts
    'https://www.canva.com',
    'https://canva.com',
    'https://onedrive.live.com',
    'https://*.onedrive.live.com',
    'https://officeapps.live.com',
    'https://*.officeapps.live.com',
    'https://view.officeapps.live.com',
    'https://1drv.ms',
    'https://sharepoint.com',
    'https://*.sharepoint.com',
    'https://www.icloud.com',
    'https://icloud.com',
    'https://embed.figma.com',
    'https://www.figma.com',
    'https://figma.com',
    'https://prezi.com',
    'https://www.prezi.com',
    'https://pitch.com',
    'https://www.pitch.com',
    'https://gamma.app',
    'https://www.gamma.app',
    'https://www.slideshare.net',
    'https://slideshare.net',
    'https://www.beautiful.ai',
    'https://beautiful.ai',
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
