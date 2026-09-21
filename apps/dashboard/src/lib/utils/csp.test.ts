import { describe, expect, it } from 'vitest';

import { PRODUCT_HOSTS } from '@cio/utils/constants';

import { getCspDomains } from './csp-domains';
import { parseCspDomains } from './csp';

describe('parseCspDomains', () => {
  it('returns an empty list for missing or blank input', () => {
    expect(parseCspDomains(undefined)).toEqual([]);
    expect(parseCspDomains('')).toEqual([]);
    expect(parseCspDomains('   ')).toEqual([]);
    expect(parseCspDomains(', ,')).toEqual([]);
  });

  it('preserves special CSP source tokens and quoted self', () => {
    expect(parseCspDomains("data:, blob:, self, 'self'")).toEqual(['data:', 'blob:', "'self'", "'self'"]);
  });

  it('keeps explicit http(s) URLs and prefixes bare domains', () => {
    expect(parseCspDomains(' https://cdn.example.com , http://localhost:9000 , fonts.gstatic.com ')).toEqual([
      'https://cdn.example.com',
      'http://localhost:9000',
      'https://fonts.gstatic.com'
    ]);
  });
});

describe('getCspDomains', () => {
  /**
   * The directives the environment cannot widen.
   *
   * `CSP_SCRIPT_SRC_DOMAINS` and `CSP_STYLE_SRC_DOMAINS` are empty on this
   * deployment, so whatever is baked in here is the whole allowlist. They named
   * an alias domain and not the product's own, which means an asset served from
   * `assets.` or `embed.` was blocked by the browser with nothing in the logs to
   * say so.
   */
  it('allows the product to load its own scripts and styles', () => {
    const { scriptSrc, styleSrc } = getCspDomains(false, null);

    expect(scriptSrc).toContain(`https://${PRODUCT_HOSTS.assets}`);
    expect(scriptSrc).toContain(`https://${PRODUCT_HOSTS.embed}`);
    expect(styleSrc.some((source) => source.startsWith(`https://${PRODUCT_HOSTS.assets}`))).toBe(true);
  });

  it('allows the product to reach its own API and tenant sites', () => {
    const { connectSrc } = getCspDomains(false, null);

    expect(connectSrc).toContain(`https://${PRODUCT_HOSTS.api}`);
    expect(connectSrc).toContain(`https://*.${PRODUCT_HOSTS.marketing}`);
    expect(connectSrc).toContain(`wss://*.${PRODUCT_HOSTS.marketing}`);
  });

  it('gives a self-hosted build nothing it did not configure', () => {
    expect(getCspDomains(true, null).scriptSrc).toEqual([]);
  });
});
