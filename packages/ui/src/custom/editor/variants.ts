/**
 * Editor presets. One editor implementation serves every authoring surface in
 * the product; a variant only decides how much of it is exposed, so a title and
 * a lesson body behave identically for the formatting they share.
 */
export type EditorVariant = 'full' | 'compact' | 'inline';

export interface EditorVariantConfig {
  /** Toolbar groups or individual commands to hide. */
  excludedCommands: string[];
  /** Block-level authoring affordances: drag handle and the slash menu. */
  allowsBlockTools: boolean;
  /** Media, table and iframe nodes; excluded from the schema when false. */
  allowsRichNodes: boolean;
  /** Restricts the document to a single paragraph and swallows Enter. */
  singleLine: boolean;
  /** Whether the expand-to-fullscreen affordance is offered by default. */
  expandableByDefault: boolean;
}

/**
 * Long-form authoring: lesson bodies, descriptions, newsfeed posts.
 */
const FULL: EditorVariantConfig = {
  excludedCommands: [],
  allowsBlockTools: true,
  allowsRichNodes: true,
  singleLine: false,
  expandableByDefault: true
};

/**
 * Short prose in a constrained container — question prompts, option text,
 * feedback. Keeps structure and maths, drops embeds that would overflow the
 * surrounding layout.
 */
const COMPACT: EditorVariantConfig = {
  // `taskList` goes with the extension: compact editors omit the list nodes, so
  // leaving the button would call a command that no longer exists.
  excludedCommands: ['media', 'table', 'alignment', 'font-size', 'search-replace', 'taskList'],
  allowsBlockTools: false,
  allowsRichNodes: false,
  singleLine: false,
  expandableByDefault: true
};

/**
 * Single-line rich text for titles. Formatting is limited to what survives
 * being rendered inside a heading, a list row or a table cell: emphasis,
 * sub/superscript and inline maths — the notation an LMS actually needs in a
 * question stem (`H₂O`, `x²`). No block structure, so a title stays one line
 * everywhere it is displayed.
 */
const INLINE: EditorVariantConfig = {
  excludedCommands: [
    'undo-redo',
    'headings',
    'alignment',
    'lists',
    'media',
    'table',
    'font-size',
    'search-replace',
    'quick-colors',
    'blockQuote',
    'paragraph'
  ],
  allowsBlockTools: false,
  allowsRichNodes: false,
  singleLine: true,
  expandableByDefault: false
};

const VARIANTS: Record<EditorVariant, EditorVariantConfig> = {
  full: FULL,
  compact: COMPACT,
  inline: INLINE
};

export function getEditorVariant(variant: EditorVariant = 'full'): EditorVariantConfig {
  return VARIANTS[variant] ?? FULL;
}
