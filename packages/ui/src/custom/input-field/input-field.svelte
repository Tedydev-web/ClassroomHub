<script lang="ts">
  import { onMount } from 'svelte';
  import * as Field from '../../base/field';
  import { Input, type InputProps } from '../../base/input';

  type InputOnChangeEvent = Parameters<NonNullable<InputProps['onchange']>>[0];
  type InputOnInputEvent = Parameters<NonNullable<InputProps['oninput']>>[0];

  interface Props {
    label?: string;
    placeholder?: string;
    value?: string | number | null;
    name?: string;
    onKeyDown?: (e: KeyboardEvent) => void;
    className?: string;
    labelClassName?: string;
    inputClassName?: string;
    type?: string;
    autoFocus?: boolean;
    isRequired?: boolean;
    isDisabled?: boolean;
    min?: string | number | null | undefined;
    max?: string | number | null | undefined;
    step?: string | number | null | undefined;
    maxLength?: number;
    errorMessage?: string;
    helperMessage?: string;
    autoComplete?: boolean;
    'aria-label'?: string;
    oninput?: (e: InputOnInputEvent) => void;
    onchange?: (e: InputOnChangeEvent) => void;
    onInputChange?: (e: InputOnChangeEvent) => void;
    labelAction?: import('svelte').Snippet;
  }

  let {
    label = '',
    placeholder = '',
    value = $bindable(),
    name = '',
    onKeyDown = (_e) => {},
    className = '',
    labelClassName = '',
    inputClassName = '',
    type = $bindable('text'),
    autoFocus = false,
    isRequired = false,
    isDisabled = false,
    min = undefined,
    max = undefined,
    step = undefined,
    maxLength = undefined,
    errorMessage = '',
    helperMessage = '',
    autoComplete = true,
    'aria-label': ariaLabel,
    oninput = () => {},
    onchange = () => {},
    onInputChange = () => {},
    labelAction
  }: Props = $props();

  let inputRef: HTMLInputElement | null = $state(null);
  const generatedInputId = $props.id();
  const inputId = $derived(name || generatedInputId);
  const messageId = $derived(`${inputId}-message`);
  const describedBy = $derived(errorMessage || helperMessage ? messageId : undefined);

  onMount(() => {
    if (autoFocus && inputRef) {
      inputRef.focus();
    }
  });

  // Handle input change event
  function handleInputChange(e: InputOnChangeEvent) {
    onInputChange(e);
  }

  // Handle blur event
  function handleBlur(e: InputOnChangeEvent) {
    onchange(e);
  }
</script>

<Field.Field class={className}>
  {#if label}
    <div class="ui:flex ui:items-center ui:justify-between">
      <Field.Label for={inputId} class={labelClassName}>
        {label}
        {#if isRequired}
          <span class="ui:text-red-700">*</span>
        {/if}
      </Field.Label>
      {@render labelAction?.()}
    </div>
  {/if}

  <Input
    class={inputClassName}
    bind:ref={inputRef}
    id={inputId}
    {type}
    {placeholder}
    bind:value
    {name}
    {min}
    {max}
    {step}
    maxlength={maxLength}
    required={isRequired}
    disabled={isDisabled}
    autocomplete={autoComplete ? 'on' : 'off'}
    aria-label={ariaLabel}
    aria-describedby={describedBy}
    aria-invalid={errorMessage ? 'true' : undefined}
    onkeydown={onKeyDown}
    {oninput}
    onchange={handleInputChange}
    onblur={handleBlur}
  />

  {#if errorMessage}
    <Field.Error id={messageId}>{errorMessage}</Field.Error>
  {:else if helperMessage}
    <Field.Description id={messageId}>{helperMessage}</Field.Description>
  {/if}
</Field.Field>
