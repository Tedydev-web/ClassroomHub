// SaaS default CSP domains, baked in at build time.
// Self-hosted (adapter-node) starts with empty lists; runtime domains
// are added via env vars in hooks.server.ts so pre-built Docker images stay configurable.
//
// The product's own hosts come from `@cio/utils` rather than being written out.
// They were written out, and named an alias domain instead: `script-src` and
// `style-src` allowed only `*.tedydev.io.vn`, and neither has anything added
// from the environment, so the moment an asset is served from the product's own
// `assets.` or `embed.` host the browser blocks it. The alias entries stay for
// now, because content already published still points at them.
import { PRODUCT_HOSTS } from '@cio/utils/constants';

const ownHosts = {
  assets: `https://${PRODUCT_HOSTS.assets}`,
  embed: `https://${PRODUCT_HOSTS.embed}`,
  api: `https://${PRODUCT_HOSTS.api}`,
  root: `https://${PRODUCT_HOSTS.marketing}`,
  tenants: `https://*.${PRODUCT_HOSTS.marketing}`,
  tenantSockets: `wss://*.${PRODUCT_HOSTS.marketing}`
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
