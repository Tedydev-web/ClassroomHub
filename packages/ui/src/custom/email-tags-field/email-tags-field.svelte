<script lang="ts" module>
  // Same email pattern the dashboard validator uses, inlined so this component
  // stays self-contained and free of app-level dependencies.
  const EMAIL_REGEX =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

  export function isValidEmail(email: string): boolean {
    return EMAIL_REGEX.test(String(email).toLowerCase());
  }

  // Emails may be pasted/typed separated by commas, semicolons or any whitespace.
  function splitEmails(raw: string): string[] {
    return raw
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
</script>

<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x';
  import * as Field from '../../base/field';
  import { cn } from '../../tools';

  interface Props {
    /** Committed list of emails (chips). Bindable. */
    emails?: string[];
    label?: string;
    placeholder?: string;
    helperMessage?: string;
    errorMessage?: string;
    name?: string;
    disabled?: boolean;
    isRequired?: boolean;
    className?: string;
    labelClassName?: string;
    /** Optional cap on how many emails can be added. */
    maxEmails?: number;
    'aria-label'?: string;
    onChange?: (emails: string[]) => void;
  }

  let {
    emails = $bindable([]),
    label = '',
    placeholder = '',
    helperMessage = '',
    errorMessage = '',
    name = '',
    disabled = false,
    isRequired = false,
    className = '',
    labelClassName = '',
    maxEmails,
    'aria-label': ariaLabel,
    onChange
  }: Props = $props();

  let inputValue = $state('');
  let inputRef: HTMLInputElement | null = $state(null);

  const generatedId = $props.id();
  const inputId = $derived(name || generatedId);
  const messageId = $derived(`${inputId}-message`);
  const describedBy = $derived(errorMessage || helperMessage ? messageId : undefined);

  function emitChange() {
    onChange?.(emails);
  }

  function addEmails(raw: string) {
    const candidates = splitEmails(raw);
    if (!candidates.length) return;

    const seen = new Set(emails.map((email) => email.toLowerCase()));
    const next = [...emails];

    for (const candidate of candidates) {
      if (maxEmails !== undefined && next.length >= maxEmails) break;
      const key = candidate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(candidate);
    }

    if (next.length !== emails.length) {
      emails = next;
      emitChange();
    }
  }

  function commitInput() {
    if (!inputValue.trim()) {
      inputValue = '';
      return;
    }
    addEmails(inputValue);
    inputValue = '';
  }

  function removeEmail(index: number) {
    emails = emails.filter((_, i) => i !== index);
    emitChange();
    inputRef?.focus();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) return;

    const commitKeys = ['Enter', ',', ';'];
    if (commitKeys.includes(event.key)) {
      event.preventDefault();
      commitInput();
      return;
    }

    if (event.key === ' ' && inputValue.trim()) {
      event.preventDefault();
      commitInput();
      return;
    }

    if (event.key === 'Tab' && inputValue.trim()) {
      event.preventDefault();
      commitInput();
      return;
    }

    if (event.key === 'Backspace' && inputValue === '' && emails.length) {
      event.preventDefault();
      removeEmail(emails.length - 1);
    }
  }

  function handlePaste(event: ClipboardEvent) {
    if (disabled) return;
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text) return;
    event.preventDefault();
    addEmails(inputValue ? `${inputValue} ${text}` : text);
    inputValue = '';
  }

  function focusInput() {
    if (!disabled) inputRef?.focus();
  }
</script>

<Field.Field class={className}>
  {#if label}
    <Field.Label for={inputId} class={labelClassName}>
      {label}
      {#if isRequired}
        <span class="ui:text-red-700">*</span>
      {/if}
    </Field.Label>
  {/if}

  <!-- Clicking anywhere in the box focuses the text input -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class={cn(
      'ui:border-input ui:bg-background ui:shadow-xs ui:flex ui:w-full ui:min-w-0 ui:flex-wrap ui:items-center ui:gap-1.5 ui:rounded-md ui:border ui:px-2 ui:py-1.5 ui:text-sm ui:transition-[color,box-shadow]',
      'ui:focus-within:border-ring ui:focus-within:ring-ring/50 ui:focus-within:ring-[3px]',
      errorMessage && 'ui:border-destructive ui:ring-destructive/20',
      disabled && 'ui:cursor-not-allowed ui:opacity-50'
    )}
    onclick={focusInput}
    role="group"
    aria-invalid={errorMessage ? 'true' : undefined}
  >
    {#each emails as email, index (email + index)}
      {@const valid = isValidEmail(email)}
      <span
        class={cn(
          'ui:inline-flex ui:max-w-full ui:items-center ui:gap-1 ui:rounded-full ui:py-0.5 ui:pl-2 ui:pr-1 ui:text-xs ui:font-medium',
          valid
            ? 'ui:bg-secondary ui:text-secondary-foreground'
            : 'ui:bg-destructive/10 ui:text-destructive ui:ring-1 ui:ring-destructive/40'
        )}
        title={valid ? email : `Invalid email: ${email}`}
      >
        <span class="ui:truncate">{email}</span>
        <button
          type="button"
          {disabled}
          class="ui:inline-flex ui:size-4 ui:shrink-0 ui:items-center ui:justify-center ui:rounded-full ui:opacity-70 ui:transition-opacity ui:hover:bg-black/10 ui:hover:opacity-100 ui:disabled:pointer-events-none ui:dark:hover:bg-white/15"
          aria-label={`Remove ${email}`}
          onclick={(event) => {
            event.stopPropagation();
            removeEmail(index);
          }}
        >
          <XIcon class="ui:size-3" />
        </button>
      </span>
    {/each}

    <input
      bind:this={inputRef}
      id={inputId}
      {name}
      type="text"
      class="ui:placeholder:text-muted-foreground ui:min-w-[8rem] ui:flex-1 ui:bg-transparent ui:py-0.5 ui:text-sm ui:outline-none ui:disabled:cursor-not-allowed"
      placeholder={emails.length ? '' : placeholder}
      bind:value={inputValue}
      {disabled}
      autocomplete="off"
      aria-label={ariaLabel || label || undefined}
      aria-describedby={describedBy}
      onkeydown={handleKeydown}
      onpaste={handlePaste}
      onblur={commitInput}
    />
  </div>

  {#if errorMessage}
    <Field.Error id={messageId}>{errorMessage}</Field.Error>
  {:else if helperMessage}
    <Field.Description id={messageId}>{helperMessage}</Field.Description>
  {/if}
</Field.Field>
