<script lang="ts">
  import * as Field from '@cio/ui/base/field';
  import { cn, normalizeRichTextValue, richTextValueToEditorHtml } from '@cio/ui/tools';
  import TextEditor from './text-editor.svelte';
  import type { EditorVariant } from '@cio/ui/custom/editor';

  interface Props {
    label?: string;
    placeholder?: string;
    /**
     * Plain text when the author has not formatted anything, HTML once they
     * have. See `rich-text-value` for why the value stays narrow.
     */
    value?: string;
    name?: string;
    variant?: EditorVariant;
    isRequired?: boolean;
    isDisabled?: boolean;
    errorMessage?: string;
    helperMessage?: string;
    className?: string;
    labelClassName?: string;
    editorClass?: string;
    'aria-label'?: string;
    oninput?: (value: string) => void;
    labelAction?: import('svelte').Snippet;
  }

  let {
    label = '',
    placeholder = '',
    value = $bindable(''),
    name = '',
    variant = 'inline',
    isRequired = false,
    isDisabled = false,
    errorMessage = '',
    helperMessage = '',
    className = '',
    labelClassName = '',
    editorClass = '',
    'aria-label': ariaLabel,
    oninput,
    labelAction
  }: Props = $props();

  const generatedId = $props.id();
  const fieldId = $derived(name || generatedId);
  const messageId = $derived(`${fieldId}-message`);
  const describedBy = $derived(errorMessage || helperMessage ? messageId : undefined);

  // Narrowing to plain text only applies to single-line fields, whose column is
  // read as a string elsewhere. A `compact` or `full` field is HTML by contract
  // and must keep its block structure verbatim.
  const narrowsToPlainText = $derived(variant === 'inline');

  // Which is also why a single-line field carries no toolbar. Every mark it could
  // apply — bold, superscript, a table — is stripped by the very next keystroke,
  // so the buttons did nothing but sit above the section titles of an imported
  // paper, one full editor toolbar per section.

  const toStored = (html: string) => (narrowsToPlainText ? normalizeRichTextValue(html) : html);
  const toEditor = (stored: string) => (narrowsToPlainText ? richTextValueToEditorHtml(stored) : stored);

  // The stored value and the editor's value are different representations, so
  // the conversion happens at the boundary rather than in every caller.
  let editorHtml = $state(toEditor(value));

  // Re-seed only when the incoming value is not our own last emission
  // round-tripped, or every keystroke would reset the caret.
  $effect(() => {
    if (toStored(editorHtml) === value) return;
    editorHtml = toEditor(value);
  });

  function handleChange(html: string) {
    editorHtml = html;
    const next = toStored(html);
    if (next === value) return;
    value = next;
    oninput?.(next);
  }
</script>

<Field.Field class={className}>
  {#if label}
    <div class="flex items-center justify-between">
      <Field.Label for={fieldId} class={labelClassName}>
        {label}
        {#if isRequired}
          <span class="text-red-700">*</span>
        {/if}
      </Field.Label>
      {@render labelAction?.()}
    </div>
  {/if}

  <!--
    `role="group"` rather than a label association: the editor is a
    contenteditable region, not a form control, so `for`/`id` would not move
    focus. The wrapper carries the id used by validation scroll-to-error.
  -->
  <!-- `tabindex="-1"` so validation code that focuses the field by id can reach
       it; a bare div is not a focus target. -->
  <div
    id={fieldId}
    role="group"
    tabindex="-1"
    aria-label={ariaLabel || label || undefined}
    aria-describedby={describedBy}
    aria-invalid={errorMessage ? 'true' : undefined}
    class={cn('rounded-md', errorMessage && 'ring-2 ring-red-500/60', isDisabled && 'pointer-events-none opacity-60')}
  >
    <TextEditor
      content={editorHtml}
      {variant}
      showToolBar={!narrowsToPlainText}
      {placeholder}
      editable={!isDisabled}
      editorClass={cn('ui:h-auto ui:min-h-11 ui:py-2', editorClass)}
      onChange={handleChange}
    />
  </div>

  {#if errorMessage}
    <Field.Error id={messageId}>{errorMessage}</Field.Error>
  {:else if helperMessage}
    <Field.Description id={messageId}>{helperMessage}</Field.Description>
  {/if}
</Field.Field>
