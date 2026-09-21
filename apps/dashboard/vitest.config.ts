import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: [
      { find: '$lib', replacement: path.resolve(__dirname, 'src/lib') },
      { find: '$features', replacement: path.resolve(__dirname, 'src/lib/features') },
      { find: '$mail', replacement: path.resolve(__dirname, 'src/mail') },
      // Workspace packages normally resolve to their built dist. The UI package
      // has no TypeScript build, so unit tests address the source barrel directly.
      { find: '@cio/ui/tools', replacement: path.resolve(__dirname, '../../packages/ui/src/tools/index.ts') },
      // Plain-TypeScript helpers the landing-page suites import. Mapped one by one
      // because a blanket @cio/ui rule would also route .svelte modules here, which
      // this node-environment runner cannot compile.
      {
        find: /^@cio\/ui\/custom\/org-landing-page\/(landing-page-link-icons|footer-social-platform|theme-style|types)$/,
        replacement: `${path.resolve(__dirname, '../../packages/ui/src/custom/org-landing-page')}/$1.ts`
      },
      // Icon packages are Svelte source, which this node-environment runner
      // cannot compile. The logic suites only need them to resolve, never to
      // render, so both icon sources point at one inert stub rather than
      // dragging a component compiler into a plain logic suite.
      {
        find: /^(@cio\/ui\/custom\/moving-icons|@lucide\/svelte\/icons\/.+)$/,
        replacement: path.resolve(__dirname, 'src/lib/test-support/moving-icons-stub.ts')
      },
      // SvelteKit virtual module; only exists inside a SvelteKit build.
      {
        find: '$env/dynamic/public',
        replacement: path.resolve(__dirname, 'src/lib/test-support/env-dynamic-public-stub.ts')
      }
    ]
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}']
  }
});
