/**
 * Reports Tailwind classes a file uses that no stylesheet the app loads ever defines.
 *
 * The dashboard imports Tailwind unprefixed and then `@cio/ui/output.css` on top. The
 * prefixed stylesheet is compiled from `packages/ui/src` alone, so a `ui:` class written in
 * an app file resolves only when the component library happens to use it too. The reverse
 * also bites: the semantic tokens — `destructive`, `card`, `muted-foreground`, `border` —
 * exist only inside that compiled bundle, so writing them unprefixed in an app file is just
 * as inert. Neither direction produces an error, a warning, or anything visible in source.
 *
 * Class names are escaped the way CSS requires, not the way they are written: every
 * character outside `[A-Za-z0-9_-]` takes a backslash, so `ui:py-1.5` is `.ui\:py-1\.5`.
 * Three earlier hand-written versions of this check reported false results by escaping only
 * the colons, which is why the escaping lives here rather than in each caller.
 *
 * Usage: node scripts/find-dead-ui-classes.mjs <stylesheet> <file...>
 *   e.g. node scripts/find-dead-ui-classes.mjs packages/ui/src/output.css apps/dashboard/src/**\/*.svelte
 */
import { readFileSync } from 'node:fs';

const [stylesheetPath, ...paths] = process.argv.slice(2);
if (!stylesheetPath || paths.length === 0) {
  console.error('usage: node scripts/find-dead-ui-classes.mjs <stylesheet> <file...>');
  process.exit(2);
}

const stylesheet = readFileSync(stylesheetPath, 'utf8');

/** The selector CSS would need for this class name. */
function escapeClassName(name) {
  return [...name].map((character) => (/[A-Za-z0-9_-]/u.test(character) ? character : `\\${character}`)).join('');
}

/**
 * Every class name the stylesheet defines.
 *
 * Collected once as a set of exact names so a lookup cannot succeed on a prefix — searching
 * for the text `.ui\:z-2` finds `.ui\:z-20` and reports a class that has no rule as safe.
 */
const defined = new Set();
for (const [, selector] of stylesheet.matchAll(/\.((?:\\.|[^\\\s{},:>+~[\]()"'])+)/g)) {
  defined.add(selector.replaceAll(/\\(.)/g, '$1'));
}

/**
 * The design tokens that exist only inside the prefixed bundle.
 *
 * `packages/ui/src/output.css` is already-compiled CSS, so its `@theme` arrives flattened
 * and never registers with the dashboard's own Tailwind instance. A colour named after one
 * of these is therefore generated in the `ui` namespace and nowhere else: written
 * unprefixed in an app file it is as inert as a misspelling. Stock utilities are the
 * opposite — the app's own build emits those from its own source, so an unprefixed
 * `min-w-3xl` is fine even though this stylesheet has never heard of it.
 */
const UI_ONLY_TOKENS =
  /-(?:destructive|card|popover|muted|muted-foreground|foreground|background|primary|secondary|accent|border|input|ring|sidebar|chart-\d)(?:\/\d+)?$/u;

let found = 0;
for (const path of paths) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    continue;
  }

  /**
   * Class-shaped strings, wherever they are written.
   *
   * Every quoted string in the file is scanned rather than only `class="…"`, because the
   * dominant forms here are `cn('…')`, `class={[…]}` and template literals — the very shapes
   * a `class=` regex cannot see, and where the last defect of this kind was hiding.
   */
  const tokens = new Set();
  for (const [, ...groups] of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
    for (const token of (groups.find((group) => group !== undefined) ?? '').split(/\s+/)) {
      if (/^(?:ui:)?[a-z][a-z0-9]*[a-z0-9\-[\]/.:_(),%#!&*+~=|^$?<>]*$/iu.test(token) && /[-:/[]/u.test(token)) {
        tokens.add(token);
      }
    }
  }

  const dead = [...tokens]
    .sort()
    // An unprefixed stock utility is the app build's job, not this stylesheet's, so only a
    // prefixed class or an unprefixed semantic token can be judged from here.
    .filter((token) => token.startsWith('ui:') || UI_ONLY_TOKENS.test(token))
    .filter((token) => !defined.has(token));
  if (dead.length === 0) continue;

  found += dead.length;
  console.log(path);
  for (const token of dead) console.log(`    ${token}`);
}

process.exit(found > 0 ? 1 : 0);
