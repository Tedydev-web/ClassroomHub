// SaaS default CSP domains, baked in at build time.
// Self-hosted (adapter-node) starts with empty lists; runtime domains
// are added via env vars in hooks.server.ts so pre-built Docker images stay configurable.

const saasDefaults = {
  scriptSrc: [
    'https://assets.classroom.tedydev.io.vn',
    'https://embed.classroom.tedydev.io.vn',
    'https://cdnjs.cloudflare.com',
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
    'https://assets.classroom.tedydev.io.vn/eqneditor_1.css',
    'https://fonts.googleapis.com'
  ],
  connectSrc: [
    'https://*.classroom.tedydev.io.vn',
    'https://classroom.tedydev.io.vn',
    'wss://*.classroom.tedydev.io.vn',
    'https://assets.classroom.tedydev.io.vn',
    'https://cdn.plyr.io',
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
    'https://docs.google.com'
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
