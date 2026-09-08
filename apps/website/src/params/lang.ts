/**
 * The locale prefix in a URL.
 *
 * Vietnamese is the default and carries no prefix, so `/pricing` is Vietnamese
 * and `/en/pricing` is English. Matching only the locales we publish keeps
 * `/pricing` from being read as `lang=pricing`, which is what an unconstrained
 * `[[lang]]` would do to every top-level page.
 */
export function match(param: string): boolean {
  return param === 'en';
}
