import { describe, expect, it } from 'vitest';

import { resolveDocumentTitle, sectionMetaTags } from './document-title';

describe('resolveDocumentTitle', () => {
  it('reads the requested locale', async () => {
    const vietnamese = await resolveDocumentTitle('vi', 'course.navItem.marks.title');
    const english = await resolveDocumentTitle('en', 'course.navItem.marks.title');

    expect(vietnamese).not.toBe('');
    expect(vietnamese).not.toBe(english);
  });

  it('falls back to English for a locale it does not ship at all', async () => {
    const english = await resolveDocumentTitle('en', 'course.navItem.marks.title');

    await expect(resolveDocumentTitle('kl', 'course.navItem.marks.title')).resolves.toBe(english);
    await expect(resolveDocumentTitle(undefined, 'course.navItem.marks.title')).resolves.toBe(english);
  });

  it('never returns the key when nothing matches', async () => {
    await expect(resolveDocumentTitle('vi', 'no.such.key.anywhere')).resolves.toBe('');
  });

  it('returns nothing for a path that lands on an object rather than a string', async () => {
    await expect(resolveDocumentTitle('en', 'course.navItem')).resolves.toBe('');
  });

  it('holds no state between calls, so one locale cannot leak into another', async () => {
    const [vietnamese, english, vietnameseAgain] = await Promise.all([
      resolveDocumentTitle('vi', 'course.navItem.marks.title'),
      resolveDocumentTitle('en', 'course.navItem.marks.title'),
      resolveDocumentTitle('vi', 'course.navItem.marks.title')
    ]);

    expect(vietnamese).toBe(vietnameseAgain);
    expect(vietnamese).not.toBe(english);
  });
});

describe('sectionMetaTags', () => {
  it('carries only the title', async () => {
    const title = await resolveDocumentTitle('vi', 'course.navItem.marks.title');

    await expect(sectionMetaTags('vi', 'course.navItem.marks.title')).resolves.toEqual({ title });
  });

  it('is undefined when there is no title, so the site default stands', async () => {
    await expect(sectionMetaTags('vi', 'no.such.key.anywhere')).resolves.toBeUndefined();
  });
});
