/**
 * Reports `ui:`-prefixed classes a file uses that the built stylesheet never defines.
 *
 * The dashboard imports Tailwind unprefixed and then `@cio/ui/output.css` on top, and that
 * stylesheet only carries the utilities `packages/ui/src` itself uses. So a `ui:` class
 * written in an app file resolves only by coincidence: common ones are there because the
 * component library uses them, and anything rarer silently has no styles at all. No error,
 * no warning, no visual difference in source — the class is simply inert.
 *
 * Every colon is escaped in the generated selector, variants included, which is why the
 * check builds the selector rather than searching for the raw token.
 *
 * Usage: node scripts/find-dead-ui-classes.mjs <file...>
 */
import { readFileSync } from 'node:fs';

const stylesheet = readFileSync('packages/ui/src/output.css', 'utf8');
let found = 0;

for (const path of process.argv.slice(2)) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    continue;
  }

  const tokens = new Set();
  for (const [, value] of source.matchAll(/class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    for (const token of (value ?? '').split(/\s+/)) {
      if (token.startsWith('ui:')) tokens.add(token);
    }
  }

  const dead = [...tokens].sort().filter((token) => !stylesheet.includes(`.${token.replaceAll(':', String.raw`\:`)}`));
  if (dead.length === 0) continue;

  found += dead.length;
  console.log(path);
  for (const token of dead) console.log(`    ${token}`);
}

process.exit(found > 0 ? 1 : 0);
