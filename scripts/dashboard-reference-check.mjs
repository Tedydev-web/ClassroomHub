/**
 * Fails the build when the dashboard references something that does not exist.
 *
 * The dashboard is the one app here with no typecheck: `vite build` compiles a reference to
 * an undeclared name without complaint, and Svelte only fails at render. That gap took the
 * whole product down once — an import the upstream merge removed while the template that
 * used it stayed — and it hid two more of the same defect: an API client renamed everywhere
 * but three call sites, and a helper the written-answer screen called without importing.
 *
 * `svelte-check` reports 300-odd pre-existing type errors, so gating on its total would gate
 * on nothing. This gates on the one class that is always a runtime crash: a name, module or
 * export that is not there. Fixing the rest is worth doing; this is what stops the bleeding.
 */
import { spawnSync } from 'node:child_process';

const FATAL = [/Cannot find name/, /Cannot find module/, /has no exported member/];

const result = spawnSync(
  'pnpm',
  ['--filter', '@cio/dashboard', 'exec', 'svelte-check', '--threshold', 'error', '--output', 'machine'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);

const lines = `${result.stdout ?? ''}`.split('\n').filter((line) => line.includes(' ERROR '));
const fatal = lines.filter((line) => FATAL.some((pattern) => pattern.test(line)));

// A svelte-check that could not run at all is a failure too: an empty report must never read
// as a clean one.
if (lines.length === 0 && result.status !== 0) {
  console.error('svelte-check did not produce a report:\n', result.stderr ?? '');
  process.exit(1);
}

console.log(`svelte-check: ${lines.length} error(s), ${fatal.length} of them references to things that do not exist`);

if (fatal.length > 0) {
  console.error('\nThese always crash at runtime:\n');
  for (const line of fatal) {
    const parsed = /^\d+ ERROR "([^"]+)" (\d+):\d+ "(.+)"$/.exec(line.trim());
    console.error(parsed ? `  ${parsed[1]}:${parsed[2]}  ${parsed[3]}` : `  ${line}`);
  }
  process.exit(1);
}
