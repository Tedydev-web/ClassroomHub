import {
  QUESTION_TYPE_KEY,
  type AssessmentDeliveryBlock,
  type ExerciseQuestionModel,
  type TextareaAnswerData
} from '@cio/question-types';

type AssessmentDeliveryInteractionBlock = Extract<AssessmentDeliveryBlock, { kind: 'interaction' }>;
type AssessmentDeliveryTextInteraction = Extract<AssessmentDeliveryInteractionBlock['interaction'], { kind: 'text' }>;

export function createAssessmentRichTextQuestion(
  blockId: string,
  interaction: AssessmentDeliveryTextInteraction
): ExerciseQuestionModel {
  return {
    id: blockId,
    title: '',
    questionType: QUESTION_TYPE_KEY.TEXTAREA,
    points: interaction.maxScore,
    required: interaction.required,
    settings: {
      minCharacters: interaction.config.minCharacters,
      maxCharacters: interaction.config.maxCharacters
    }
  };
}

export function createAssessmentRichTextAnswer(text: string): TextareaAnswerData {
  return { type: QUESTION_TYPE_KEY.TEXTAREA, text };
}
