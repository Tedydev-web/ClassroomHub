// `vite build` and `vite dev` both bind :8000, and building while the dev server
// is up rewrites the `.svelte-kit` output that running server is reading, leaving
// it in a broken state. This guard refuses to build when something is already on
// the port — almost always a forgotten `pnpm dev`.
//
// It is skipped under CI. A hosted runner has nothing on :8000, and the
// self-hosted runner shares this machine with the dev server on purpose: there
// the collision is expected and the build must proceed anyway, each in its own
// checkout, so the guard would be a false positive that fails every build.
import { execSync } from 'node:child_process';

if (process.env.CI) {
  process.exit(0);
}

try {
  execSync('wait-on --reverse tcp:127.0.0.1:8000 --timeout 1s', { stdio: 'inherit' });
} catch {
  console.error(
    '\nSomething is already listening on :8000 (usually `pnpm dev`).\n' +
      'Stop it before building — an overlapping build corrupts its .svelte-kit output.\n'
  );
  process.exit(1);
}
