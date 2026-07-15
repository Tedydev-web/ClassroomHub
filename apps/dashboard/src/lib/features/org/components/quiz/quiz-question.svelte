<script lang="ts">
  import { CircleCheckIcon } from '$features/ui/icons';
  import { optionImage } from '$lib/utils/constants/quiz';
  import { InputField } from '@cio/ui/custom/input-field';
  import { IconButton } from '@cio/ui/custom/icon-button';
  import { t } from '$lib/utils/functions/translations';

  interface QuizOption {
    id: string;
    label: string;
    isCorrect: boolean;
  }

  interface QuizQuestionData {
    label: string;
    type?: string;
    options?: QuizOption[];
  }

  interface QuizQuestionError {
    isLabelEmpty?: boolean;
    options?: Array<{ id: string; error: boolean }>;
  }

  interface Props {
    currentQuestion?: QuizQuestionData;
    currentError?: QuizQuestionError;
    optionHasError?: (optionId: string, errors?: Array<{ id: string; error: boolean }>) => boolean;
    isPreview?: boolean;
  }

  let {
    currentQuestion = $bindable({
      label: ''
    }),
    currentError = {},
    optionHasError = () => false,
    isPreview = false
  }: Props = $props();

  function getOptionImage(optionId: string): string {
    return optionImage[optionId as keyof typeof optionImage] ?? '';
  }
</script>

{#if isPreview}
  <h1 class="mb-5 text-white">{currentQuestion.label}</h1>
{:else}
  <InputField
    placeholder={$t('components.quiz.start_typing')}
    bind:value={currentQuestion.label}
    className="w-full my-4"
    errorMessage={currentError.isLabelEmpty && $t('components.quiz.required_field')}
    isRequired={true}
    bgColor="bg-white"
  />
{/if}

<!-- Options -->
<div class="flex w-full flex-wrap justify-between">
  {#each currentQuestion.options || [] as option (option.id)}
    <div class="relative mb-5 w-2/5 rounded bg-white p-5 dark:bg-neutral-800">
      <img src={getOptionImage(option.id)} alt={option.id} />

      {#if isPreview}
        <p class="mt-5">{option.label}</p>
      {:else}
        <InputField
          bind:value={option.label}
          placeholder={$t('components.quiz.type_answer')}
          bgColor="bg-white"
          className="mt-3"
          isDisabled={currentQuestion.type === 'boolean'}
          errorMessage={optionHasError(option.id, currentError.options) && $t('components.quiz.label')}
        />
        <div class="absolute top-2 right-2 flex justify-end">
          <IconButton onclick={() => (option.isCorrect = !option.isCorrect)} class={option.isCorrect ? 'success' : ''}>
            <CircleCheckIcon size={16} filled={option.isCorrect} />
          </IconButton>
        </div>
      {/if}
    </div>
  {/each}
</div>
