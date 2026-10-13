<script lang="ts">
  import {
    getExerciseQuestionLabel,
    type ExerciseQuestionModel,
    type ExerciseQuestionRendererProps
  } from '@cio/question-types';
  import { Textarea } from '../../../../base/textarea';
  import { Label } from '../../../../base/label';

  let { question, disabled = false, labels, onQuestionChange = () => {} }: ExerciseQuestionRendererProps = $props();
  const label = (key: Parameters<typeof getExerciseQuestionLabel>[1], fallback = '') =>
    getExerciseQuestionLabel(labels, key, fallback);

  function patchQuestion(partial: Partial<ExerciseQuestionModel>) {
    onQuestionChange({ ...question, ...partial });
  }
  const fieldId = $props.id();
</script>

<div class="ui:space-y-3">
  <!-- The field's only label was its placeholder, which disappears once instructions are written. -->
  <Label for={fieldId} class="ui:text-muted-foreground ui:text-xs ui:font-normal"
    >{label('short_answer.edit.instructions_placeholder')}</Label
  >
  <Textarea
    id={fieldId}
    class="ui:w-full"
    rows={2}
    placeholder={label('short_answer.edit.instructions_placeholder')}
    value={String((question.settings?.instructions as string | undefined) ?? '')}
    {disabled}
    oninput={(event) =>
      patchQuestion({ settings: { ...(question.settings ?? {}), instructions: event.currentTarget.value } })}
  />
</div>
