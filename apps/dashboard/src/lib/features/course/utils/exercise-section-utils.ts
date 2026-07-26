import { isRichTextHtml, richTextToPlainText } from '@cio/ui/tools';

export const UNTITLED_EXERCISE_SECTION_TITLE = 'Untitled section';

function sectionTitleFallback(title: string, sectionNumber: number, sectionLabel: string): string | null {
  const plainTitle = richTextToPlainText(title);
  return plainTitle.trim() === UNTITLED_EXERCISE_SECTION_TITLE || plainTitle.trim() === ''
    ? `${sectionLabel} ${sectionNumber}`
    : null;
}

/** Plain text for sidebars, dropdowns and labels that cannot render markup. */
export function getExerciseSectionDisplayTitle({
  title,
  sectionNumber,
  sectionLabel
}: {
  title: string;
  sectionNumber: number;
  sectionLabel: string;
}) {
  return sectionTitleFallback(title, sectionNumber, sectionLabel) ?? richTextToPlainText(title);
}

/** Authored markup for heading surfaces, with the same fallback as the plain helper. */
export function getExerciseSectionDisplayHtml({
  title,
  sectionNumber,
  sectionLabel
}: {
  title: string;
  sectionNumber: number;
  sectionLabel: string;
}) {
  const fallback = sectionTitleFallback(title, sectionNumber, sectionLabel);
  if (fallback) return fallback;

  return isRichTextHtml(title) ? title : richTextToPlainText(title);
}
