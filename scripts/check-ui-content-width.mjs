// A width utility that overrides a `@cio/ui` surface must carry the `ui:` prefix.
//
// The base components are compiled with `prefix(ui)`, so `Dialog.Content` already carries
// `ui:w-full ui:max-w-[calc(100%-2rem)] ui:sm:max-w-lg`. An override written unprefixed —
// `class="sm:max-w-md"` — does emit CSS, but `tailwind-merge` is configured for the `ui:`
// prefix and cannot see the two as the same property, so neither is dropped and the cascade
// decides. Measured in the built stylesheet: the unprefixed rule lands at byte 103,295 and
// the base's `calc(100% - 2rem)` at 142,658, so the base wins and the dialog opens as wide as
// the window. Prefixing moves the override to 293,028, after the base, where it belongs.
//
// This applies only to overrides of a `ui:`-prefixed surface. A plain `max-w-md` on a plain
// `<div>` in the dashboard is correct and is not flagged.

import { readFileSync } from 'node:fs';

// Modal surfaces only. These are the ones whose base sets `ui:max-w-[calc(100%-2rem)]`, so a
// losing override opens the surface as wide as the window. A popover or dropdown sets a width
// and no max-width, where the same mistake costs a wrong width rather than a broken screen —
// worth fixing, not worth blocking a commit over.
const SURFACES = /\b(?:Dialog|Sheet|Drawer|AlertDialog)\.Content\b/;
const CLASS_ATTR = /class="([^"]*)"/g;
/**
 * `max-w-…`, with or without a responsive modifier.
 *
 * A trailing `!` is deliberately excluded: `!important` beats the base rule wherever it lands
 * in the cascade, so those overrides do work. They are leaning on importance rather than on
 * the prefix, which is worth knowing but is not a broken screen.
 */
const WIDTH_UTILITY = /^(?:(?:sm|md|lg|xl|2xl):)*max-w-[^!]*$/;

const files = process.argv.slice(2).filter((file) => file.endsWith('.svelte'));
const offences = [];

for (const file of files) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  source.split('\n').forEach((line, index) => {
    if (!SURFACES.test(line)) return;

    for (const [, value] of line.matchAll(CLASS_ATTR)) {
      for (const token of value.split(/\s+/).filter(Boolean)) {
        if (token.startsWith('ui:')) continue;
        if (!WIDTH_UTILITY.test(token)) continue;

        offences.push(`${file}:${index + 1}  ${token}`);
      }
    }
  });
}

if (offences.length === 0) process.exit(0);

console.error('\nWidth utilities on a @cio/ui surface must carry the ui: prefix.\n');
for (const offence of offences) console.error(`  ${offence}`);
console.error(
  '\nWrite ui:sm:max-w-md, not sm:max-w-md — the prefix goes outermost.\n' +
    'Without it the component keeps its own ui:max-w-[calc(100%-2rem)] and opens full width.\n'
);
process.exit(1);
