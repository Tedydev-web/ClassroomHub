import { describe, expect, it } from 'vitest';

import { getOrgFaviconHref } from './org-branding';

type Org = Parameters<typeof getOrgFaviconHref>[0];

describe('getOrgFaviconHref', () => {
  it('prefers the favicon an organisation set, then its avatar', () => {
    const origin = 'https://msna.classroom.io.vn';

    expect(getOrgFaviconHref({ favicon: '/f.png', avatarUrl: '/a.png' } as Org, origin)).toBe(`${origin}/f.png`);
    expect(getOrgFaviconHref({ favicon: '', avatarUrl: '/a.png' } as Org, origin)).toBe(`${origin}/a.png`);
  });

  /**
   * An organisation site that set neither used to emit no icon link at all,
   * leaving the tab with the browser's blank-page glyph beside a fully branded
   * page. Every origin the app answers on carries the platform mark.
   */
  it('falls back to the platform mark rather than to no icon', () => {
    const origin = 'https://msna.classroom.io.vn';

    expect(getOrgFaviconHref(null, origin)).toBe(`${origin}/logo-32.png`);
    expect(getOrgFaviconHref({ favicon: null, avatarUrl: null } as Org, origin)).toBe(`${origin}/logo-32.png`);
    expect(getOrgFaviconHref({ favicon: '  ', avatarUrl: '  ' } as Org, origin)).toBe(`${origin}/logo-32.png`);
  });
});
