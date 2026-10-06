import { defineConfig, loadEnv } from 'vite';

import { sveltekit } from '@sveltejs/kit/vite';
import mkcert from 'vite-plugin-mkcert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardDir = path.dirname(fileURLToPath(import.meta.url));

function watchWorkspaceSources() {
  return {
    name: 'watch-workspace-sources',
    configureServer(server) {
      server.watcher.add(path.resolve(dashboardDir, '../../packages/ui/src'));
      server.watcher.add(path.resolve(dashboardDir, '../../packages/utils/dist'));
    }
  };
}

export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
  const useHttps = process.env.HTTPS === 'true' || process.env.VITE_USE_HTTPS_ON_LOCALHOST === 'true';
  const host = process.env.HOST || (useHttps ? '0.0.0.0' : undefined);

  return defineConfig({
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ['legacy-js-api']
        }
      }
    },
    plugins: [
      redirectToCanonicalOrigin(process.env),
      watchWorkspaceSources(),
      sveltekit(),
      ...(useHttps ? [mkcert()] : [])
    ],
    server: {
      host,
      // `getServer` has built this from VITE_ALLOWED_HOST since it was written, but nothing
      // called it — so reaching the dev server through any hostname other than localhost was
      // refused by Vite with no way to allow it. Wiring it up is the whole of the fix; the
      // function itself was already right.
      ...getServer(process.env),
      fs: {
        // `..` is `apps/` — covers the dashboard's own files. `../../packages`
        // is required so Vite's `@fs` route can serve dynamic imports that
        // workspace packages (e.g. `@cio/ui/custom/editor`) emit as absolute
        // paths into their own source tree. Without it, dev 403s on those
        // `@fs/.../packages/ui/...` URLs.
        allow: ['..', '../../packages']
      },
      watch: {
        ignored: ['**/node_modules/!(@cio)/**', '**/.git/**']
      }
    },
    build: {
      // Sentry is not wired here (no PUBLIC_SENTRY_DSN, no upload step), so
      // source maps were never consumed. Emitting them for the merged chart
      // modules blew past the V8 heap in rollup's render phase (SIGSEGV at 8GB
      // and 12GB), so they stay off until sourcemap upload is actually set up.
      sourcemap: false,
      target: 'es2020'
    },
    ssr: {
      // LayerChart has internal circular imports. Pre-bundling its SSR graph avoids
      // Vite 5 evaluating partially initialized Svelte modules during cold loads.
      optimizeDeps: {
        include: ['layerchart']
      },
      // svelte-motion uses directory imports without `/index.js`; Node ESM fails unless bundled for SSR.
      noExternal: [
        'svelte-sonner',
        'layerchart',
        'svelte-toolbelt',
        'tldts',
        'tldts-core',
        'svelte-motion',
        'svelte-inview'
      ]
    },
    optimizeDeps: {
      entries: ['src/routes/**/+*.{js,ts,svelte}'],
      include: ['@cio/api/rpc-types'],
      // Keep type and utility workspaces live so HMR sees newly built exports.
      // UI remains pre-bundled because LayerChart's circular graph is unstable
      // when Vite evaluates the complete UI workspace directly during SSR.
      exclude: ['@cio/utils', '@cio/question-types']
    },
    resolve: {
      mainFields: ['browser']
    }
  });
};

function redirectToCanonicalOrigin(params) {
  const { VITE_CANONICAL_ORIGIN, VITE_REDIRECT_HOST } = params || {};

  return {
    name: 'redirect-to-canonical-origin',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!VITE_CANONICAL_ORIGIN || request.headers.host !== VITE_REDIRECT_HOST) {
          next();
          return;
        }

        response.statusCode = 302;
        response.setHeader('Location', `${VITE_CANONICAL_ORIGIN}${request.url ?? '/'}`);
        response.end();
      });
    }
  };
}

function getServer(params) {
  // HTTPS is handled by the mkcert plugin above, which issues a locally trusted
  // certificate. The branch that stood here read `cert/key.pem` and `cert/cert.pem`
  // from this directory — files this repository has never contained — so turning
  // it on threw before the server started.
  const { VITE_ALLOWED_HOST } = params || {};

  return {
    allowedHosts: VITE_ALLOWED_HOST
      ? [
          ...new Set([
            ...VITE_ALLOWED_HOST.split(',')
              .map((host) => host.trim())
              .filter(Boolean),
            '.classroom.io.vn'
          ])
        ]
      : ['.classroom.io.vn']
  };
}

// function getSentryConfig(params: any) {
//   const { VITE_SENTRY_AUTH_TOKEN, VITE_SENTRY_ORG_NAME, VITE_SENTRY_PROJECT_NAME } = params || {};
//   if (VITE_SENTRY_AUTH_TOKEN) {
//     return {
//       url: 'https://sentry.io',
//       authToken: VITE_SENTRY_AUTH_TOKEN,
//       org: VITE_SENTRY_ORG_NAME,
//       project: VITE_SENTRY_PROJECT_NAME,
//       options: {
//         telemetry: false,
//       }
//     };
//   }
//   return {};
// }
