<script lang="ts">
  import {
    getExerciseQuestionLabel,
    type ExerciseQuestionModel,
    type ExerciseQuestionRendererProps
  } from '@cio/question-types';
  import { Textarea } from '../../../../base/textarea';

  let { question, disabled = false, labels, onQuestionChange = () => {} }: ExerciseQuestionRendererProps = $props();
  const label = (key: Parameters<typeof getExerciseQuestionLabel>[1], fallback = '') =>
    getExerciseQuestionLabel(labels, key, fallback);

  function patchQuestion(partial: Partial<ExerciseQuestionModel>) {
    onQuestionChange({ ...question, ...partial });
  }

  function patchSettings(next: Record<string, unknown>) {
    patchQuestion({ settings: { ...(question.settings ?? {}), ...next } });
  }
</script>

<div class="ui:space-y-3">
  <!--
    The label was doing its work from inside the placeholder, which disappears the moment the
    field has content — that is, exactly when an author returns to an existing question and needs
    to know what the field is and how its values are separated. Shown above the field, in the same
    shape the word bank editor already uses, so the two read alike.
  -->
  <p class="ui:text-muted-foreground ui:text-xs">{label('fill_blank.edit.accepted_answers_placeholder')}</p>
  <Textarea
    class="ui:w-full"
    rows={2}
    placeholder={label('fill_blank.edit.accepted_answers_placeholder')}
    value={String((question.settings?.acceptedAnswers as string | undefined) ?? '')}
    {disabled}
    onchange={(event) => patchSettings({ acceptedAnswers: event.currentTarget.value })}
  />
</div>
