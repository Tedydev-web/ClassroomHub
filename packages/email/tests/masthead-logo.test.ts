import { describe, expect, it } from 'vitest';

import { PRODUCT_LOGO_URL } from '@cio/utils/constants';

import { getDefaultTemplate } from '../src/templates/default';

/**
 * An organisation's logo reached the masthead as whatever string the record held, straight
 * into `src`. A message has no document to resolve a relative path against and no session to
 * send with the request — whatever a reader's client fetches, it fetches cold from an address
 * that has to stand on its own. A root-relative path therefore renders as a broken-image box
 * beside the organisation's name, in every client, always.
 */
function masthead(branding: { orgName?: string; logoUrl?: string }): string {
  const html = getDefaultTemplate('<p>body</p>', branding as never);

  return html.slice(0, html.indexOf('<p>body</p>'));
}

describe('the masthead logo', () => {
  it('draws an absolute address', () => {
    const head = masthead({ orgName: 'MsNa English', logoUrl: 'https://cdn.example.com/msna.png' });

    expect(head).toContain('src="https://cdn.example.com/msna.png"');
    expect(head).toContain('MsNa English');
  });

  it('refuses a relative path and draws the platform mark instead', () => {
    // The case that shipped: a broken-image box where a readable name belongs.
    const head = masthead({ orgName: 'MsNa English', logoUrl: '/media/org/msna/avatar.png' });

    expect(head).not.toContain('<img src="/media');
    expect(head).toContain(PRODUCT_LOGO_URL);
    expect(head).toContain('MsNa English');
  });

  it('refuses addresses no client will fetch', () => {
    for (const logoUrl of ['data:image/png;base64,AAAA', 'mailto:someone@example.com', 'not a url', '']) {
      const head = masthead({ orgName: 'MsNa English', logoUrl });

      expect(head).not.toContain(logoUrl || 'src=""');
      expect(head).toContain(PRODUCT_LOGO_URL);
    }
  });

  /**
   * An organisation that never uploaded a mark still gets one. A masthead of
   * bare text above a styled card reads as a rendering failure — which is
   * exactly what a reader who has just seen a broken image concludes.
   */
  it('draws the platform mark for an organisation that set no logo', () => {
    const head = masthead({ orgName: 'MsNa English' });

    expect(head).toContain(`<img src="${PRODUCT_LOGO_URL}"`);
    expect(head).toContain('MsNa English');
  });

  it('escapes the address into the attribute, so a quote cannot break out of it', () => {
    const head = masthead({ orgName: 'MsNa English', logoUrl: 'https://cdn.example.com/a".png' });

    expect(head).not.toContain('a".png"');
    expect(head).toContain('&quot;');
  });

  it('still falls back to the product wordmark when there is no branding at all', () => {
    expect(masthead({})).toContain('wordmark.png');
  });
});
