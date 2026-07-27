import type { AssessmentItemDefinition } from './assessment-item-schema';
import type { AssessmentResponseEnvelope } from './assessment-response-envelope';

export type ReleasedAssessmentFeedback =
  | {
      id: string;
      scope: 'item';
      html: string;
    }
  | {
      id: string;
      scope: 'choice_option';
      interactionId: string;
      optionId: string;
      html: string;
    };

export type AssessmentFeedbackReleasePhase = 'after_submit' | 'after_grading';

export function resolveReleasedAssessmentFeedback(
  definition: AssessmentItemDefinition,
  response: AssessmentResponseEnvelope,
  phase: AssessmentFeedbackReleasePhase
): ReleasedAssessmentFeedback[] {
  const selectedOptionsByInteractionId = new Map(
    response.responses.flatMap((entry) =>
      entry.response.kind === 'choice'
        ? [[entry.interactionId, new Set(entry.response.selectedOptionIds)] as const]
        : []
    )
  );

  return (definition.feedback ?? []).flatMap((feedback): ReleasedAssessmentFeedback[] => {
    if (feedback.visibility === 'after_grading' && phase !== 'after_grading') return [];
    if (feedback.scope === 'item') {
      return [{ id: feedback.id, scope: feedback.scope, html: feedback.html }];
    }

    const selectedOptions = selectedOptionsByInteractionId.get(feedback.interactionId);
    if (!selectedOptions?.has(feedback.optionId)) return [];

    return [
      {
        id: feedback.id,
        scope: feedback.scope,
        interactionId: feedback.interactionId,
        optionId: feedback.optionId,
        html: feedback.html
      }
    ];
  });
}
