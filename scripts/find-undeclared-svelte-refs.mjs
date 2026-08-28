#!/usr/bin/env node
/**
 * Reports names a Svelte template uses that its script never brings into scope.
 *
 * Svelte compiles a reference to a name that does not exist. `vite build` stays green,
 * eslint stays green, the tests stay green, and the page throws `X is not defined` the
 * moment somebody opens it. That failure shipped three times in one day on the exam
 * routes — twice as deleted state (`needsPassword`, `confirmStart`) and once as a
 * component used without its import (`Button`) — so the check exists to make the class of
 * mistake visible without opening a browser.
 *
 * It is a lint, not a compiler: it reads the script for anything that looks like a
 * declaration or an import and the markup for anything that looks like a reference. That
 * makes it prone to false positives on unusual syntax and unable to see across files. A
 * clean run is not proof the page renders — only opening the page is that.
 *
 * Usage: node scripts/find-undeclared-svelte-refs.mjs <file.svelte...>
 */
import { readFileSync } from 'node:fs';

/** Names Svelte, the browser, or the language provides without anybody declaring them. */
const AMBIENT = new Set([
  'if',
  'else',
  'each',
  'as',
  'await',
  'then',
  'catch',
  'key',
  'snippet',
  'render',
  'html',
  'const',
  'debug',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'globalThis',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Date',
  'JSON',
  'Object',
  'Array',
  'Set',
  'Map',
  'Intl',
  'Promise',
  'RegExp',
  'Error',
  'BigInt',
  'Symbol',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'fetch',
  'URL',
  'URLSearchParams',
  'Blob',
  'FormData',
  'CustomEvent',
  'Event',
  'void',
  'typeof',
  'in',
  'instanceof',
  'new',
  'return',
  'function',
  'class',
  'import',
  'export',
  'default',
  'delete'
]);

function declaredNames(script) {
  const names = new Set();

  for (const match of script.matchAll(/\b(?:let|const|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of script.matchAll(/\b(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  // Import clauses, including `* as ns`, default, and named-with-alias forms.
  for (const match of script.matchAll(/import\s+([\s\S]+?)\s+from\s+['"]/g)) {
    for (const name of match[1].matchAll(/([A-Za-z_$][\w$]*)/g)) names.add(name[1]);
  }
  // Anything destructured anywhere, which covers `let { a, b } = $props()`.
  for (const match of script.matchAll(/[{[]([^{}[\]]*)[}\]]\s*[:=]/g)) {
    for (const name of match[1].matchAll(/([A-Za-z_$][\w$]*)/g)) names.add(name[1]);
  }
  // Snippet parameters and every function's parameter list.
  for (const match of script.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const name of match[1].matchAll(/([A-Za-z_$][\w$]*)/g)) names.add(name[1]);
  }

  return names;
}

function referencedNames(markup) {
  const names = new Set();

  // Class attributes are stripped first. They are mostly Tailwind, whose fragments look
  // exactly like identifiers to a regex, and every name reported from one so far has been
  // noise. A component is never referenced from inside a class string, so nothing real is
  // lost — and a check that cries wolf is a check nobody runs.
  markup = markup.replace(/class=(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})/g, 'class=""');

  // Components: <Foo> and <Foo.Bar>, which need the root name in scope.
  for (const match of markup.matchAll(/<([A-Z][\w$]*)/g)) names.add(match[1]);

  // Expressions in braces, plus the parameters snippets introduce inside the markup.
  const local = new Set();
  for (const match of markup.matchAll(/\{#(?:each|snippet|await)\s+([\s\S]*?)\}/g)) {
    for (const name of match[1].matchAll(/([A-Za-z_$][\w$]*)/g)) local.add(name[1]);
  }
  // `{@const x = …}` declares x for the rest of the block, in the markup rather than the script.
  for (const match of markup.matchAll(/\{@const\s+([A-Za-z_$][\w$]*)/g)) local.add(match[1]);
  // Callbacks written inline in an attribute bring their own parameters with them.
  for (const match of markup.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const name of match[1].matchAll(/([A-Za-z_$][\w$]*)/g)) local.add(name[1]);
  }

  for (const match of markup.matchAll(/\{([^{}]*)\}/g)) {
    const expression = match[1];
    // Skip class strings, which are full of words that only look like identifiers.
    for (const name of expression.matchAll(/(?<![\w$.'"`])([A-Za-z_$][\w$]*)\s*(?=[(.[,)\]}?|&=!<>+\-*/\s]|$)/g)) {
      // A name followed by a colon is an object key — `{ count: total }` — not a read.
      names.add(name[1]);
    }
  }

  for (const name of local) names.delete(name);

  return names;
}

let failures = 0;

for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, 'utf8');
  const scriptEnd = source.lastIndexOf('</script>');
  if (scriptEnd < 0) continue;

  const script = source.slice(0, scriptEnd);
  const markup = source.slice(scriptEnd);

  const declared = declaredNames(script);
  const missing = [...referencedNames(markup)]
    .filter(
      (name) => !declared.has(name) && !AMBIENT.has(name) && !name.startsWith('$') && !/^HTML\w*Element$/.test(name)
    )
    // Class-name fragments arrive lowercase and unquoted from `class={[...]}`; a real
    // reference is either capitalised (a component) or appears in the script somewhere.
    .filter((name) => /^[A-Z]/.test(name) || new RegExp(`\\b${name}\\b`).test(script))
    .sort();

  if (missing.length > 0) {
    failures += 1;
    console.log(file);
    for (const name of missing) console.log(`    ${name}`);
  }
}

process.exit(failures > 0 ? 1 : 0);
