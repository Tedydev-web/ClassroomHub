import { describe, expect, it } from 'vitest';
import {
  isListNumberFormat,
  renderListLabel,
  renderListLabelForCounter,
  type ListLevelDefinition
} from '../src/docx/list-label';

function level(overrides: Partial<ListLevelDefinition> = {}): ListLevelDefinition {
  return { format: 'decimal', text: '%1.', start: 1, ...overrides };
}

describe('rendering an automatic list label', () => {
  it('renders the option letters an exam paper uses', () => {
    const options = level({ format: 'upperLetter' });

    expect([0, 1, 2, 3].map((index) => renderListLabel(options, index))).toEqual(['A.', 'B.', 'C.', 'D.']);
  });

  // Real case from the reference exam: the arrangement questions put item "a"
  // inline in the stem and auto-number the rest, so the list starts at "b".
  it('honours a start value other than one', () => {
    const fromB = level({ format: 'lowerLetter', start: 2 });

    expect([0, 1, 2, 3].map((index) => renderListLabel(fromB, index))).toEqual(['b.', 'c.', 'd.', 'e.']);
  });

  it('renders decimal, roman, and lowercase variants', () => {
    expect(renderListLabel(level({ format: 'decimal' }), 10)).toBe('11.');
    expect(renderListLabel(level({ format: 'upperRoman' }), 3)).toBe('IV.');
    expect(renderListLabel(level({ format: 'lowerRoman' }), 8)).toBe('ix.');
    expect(renderListLabel(level({ format: 'lowerLetter' }), 0)).toBe('a.');
  });

  it('applies the template rather than assuming a trailing dot', () => {
    expect(renderListLabel(level({ format: 'upperLetter', text: '(%1)' }), 2)).toBe('(C)');
    expect(renderListLabel(level({ format: 'decimal', text: 'Question %1:' }), 0)).toBe('Question 1:');
  });

  it('returns the bullet glyph for a bullet level', () => {
    expect(renderListLabel(level({ format: 'bullet', text: '-', start: 0 }), 5)).toBe('-');
  });

  it('renders nothing for a level that shows no label', () => {
    expect(renderListLabel(level({ format: 'none' }), 0)).toBeNull();
  });

  it('refuses to invent a letter for a counter at or below zero', () => {
    // A file may declare start="0"; letters have no representation there, and a
    // guess would silently mislabel every option in the list.
    expect(renderListLabel(level({ format: 'upperLetter', start: 0 }), 0)).toBeNull();
    expect(renderListLabel(level({ format: 'lowerRoman', start: 0 }), 0)).toBeNull();
  });

  it('still renders zero and negative counters in decimal, where they are meaningful', () => {
    expect(renderListLabel(level({ format: 'decimal', start: 0 }), 0)).toBe('0.');
  });

  it('continues past the twenty-sixth item without collapsing onto Z', () => {
    const letters = level({ format: 'upperLetter' });

    expect(renderListLabel(letters, 25)).toBe('Z.');
    expect(renderListLabel(letters, 26)).toBe('AA.');
    expect(renderListLabel(letters, 27)).toBe('BB.');
  });

  it('substitutes every placeholder occurrence in the template', () => {
    expect(renderListLabel(level({ format: 'upperLetter', text: '%1-%1' }), 0)).toBe('A-A');
  });

  it('falls back to the bare counter when the template is empty', () => {
    expect(renderListLabel(level({ format: 'upperLetter', text: '' }), 0)).toBe('A');
  });
});

describe('rendering from an explicit counter', () => {
  // officeparser reports `itemIndex` as the counter minus one, with `start`
  // already applied. Feeding that through the zero-based overload would add
  // `start` a second time and shift every label. These cases pin the
  // distinction so the two overloads are not swapped later.
  it('does not apply start a second time', () => {
    const fromB = level({ format: 'lowerLetter', start: 2 });

    // A list starting at "b" reports itemIndex 1 for its first item.
    expect(renderListLabelForCounter(fromB, 1 + 1)).toBe('b.');
    expect(renderListLabelForCounter(fromB, 4 + 1)).toBe('e.');
  });

  it('agrees with the zero-based overload once start is accounted for', () => {
    const fromB = level({ format: 'lowerLetter', start: 2 });

    expect(renderListLabel(fromB, 0)).toBe(renderListLabelForCounter(fromB, 2));
  });

  it('handles the counter a bullet list reports below zero', () => {
    expect(renderListLabelForCounter(level({ format: 'bullet', text: '-', start: 0 }), 0)).toBe('-');
    expect(renderListLabelForCounter(level({ format: 'upperLetter' }), 0)).toBeNull();
  });
});

describe('format recognition', () => {
  it('accepts the formats Word writes', () => {
    expect(isListNumberFormat('upperLetter')).toBe(true);
    expect(isListNumberFormat('bullet')).toBe(true);
  });

  it('rejects a format it cannot render, so callers do not silently mislabel', () => {
    expect(isListNumberFormat('ideographDigital')).toBe(false);
    expect(isListNumberFormat('')).toBe(false);
  });
});
