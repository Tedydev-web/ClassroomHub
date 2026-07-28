import type { AssessmentInteraction, AssessmentItemDefinition } from './assessment-item-schema';

/**
 * Applies `transform` to every authored HTML field (content html, prompts,
 * choice/ordering option html, feedback html) and nothing else. Identifiers,
 * scores, instructions, templates, and answer keys are never transformed.
 *
 * The server uses this with its HTML sanitizer before validation and hashing,
 * implementing the field-specific sanitization rule (no recursive
 * sanitize-everything pass).
 */
export function mapAuthoredHtml(
  definition: AssessmentItemDefinition,
  transform: (html: string) => string
): AssessmentItemDefinition {
  return {
    ...definition,
    blocks: definition.blocks.map((block) =>
      block.kind === 'content'
        ? { ...block, content: { ...block.content, html: transform(block.content.html) } }
        : { ...block, interaction: mapInteractionHtml(block.interaction, transform) }
    ),
    feedback: definition.feedback.map((feedback) => ({ ...feedback, html: transform(feedback.html) }))
  };
}

function mapInteractionHtml(
  interaction: AssessmentInteraction,
  transform: (html: string) => string
): AssessmentInteraction {
  const prompt = { ...interaction.prompt, html: transform(interaction.prompt.html) };

  switch (interaction.kind) {
    case 'choice':
      return {
        ...interaction,
        prompt,
        config: {
          ...interaction.config,
          options: interaction.config.options.map((option) => ({ ...option, html: transform(option.html) }))
        }
      };
    case 'ordering':
      return {
        ...interaction,
        prompt,
        config: {
          ...interaction.config,
          options: interaction.config.options.map((option) => ({ ...option, html: transform(option.html) }))
        }
      };
    case 'true_false_group':
      return {
        ...interaction,
        prompt,
        config: {
          ...interaction.config,
          statements: interaction.config.statements.map((statement) => ({
            ...statement,
            html: transform(statement.html)
          }))
        }
      };
    case 'text':
    case 'numeric':
    case 'fill_blank':
    case 'word_bank':
    case 'file_upload':
    case 'link':
    case 'star_rating':
    case 'video_recording':
      return { ...interaction, prompt };
  }

  interaction satisfies never;
  throw new Error('Unsupported assessment interaction kind');
}
