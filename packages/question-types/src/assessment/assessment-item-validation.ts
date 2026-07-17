import { isRecord, isUnique } from '../question-answer-validation';
import { isExactStringPermutation } from '../question-answer-validation';
import {
  assessmentFailure,
  assessmentIssue,
  assessmentSuccess,
  zodIssuesToAssessmentIssues,
  type AssessmentIssue,
  type AssessmentResult
} from './assessment-errors';
import {
  ASSESSMENT_INTERACTION_KINDS,
  assessmentItemDefinitionSchema,
  getAssessmentInteractionBlocks,
  type AssessmentInteraction,
  type AssessmentItemDefinition
} from './assessment-item-schema';
import { MAX_ASSESSMENT_INTERACTIONS } from './assessment-limits';

const KNOWN_INTERACTION_KINDS: ReadonlySet<string> = new Set(ASSESSMENT_INTERACTION_KINDS);

/** Word-bank blanks are runs of three or more underscores (mirrors exercise validation). */
const WORD_BANK_BLANK_PATTERN = /_{3,}/g;

/**
 * Reports unknown interaction kinds before the full schema runs so callers can
 * distinguish "from the future" from "malformed" (FR-5: never coerced).
 */
function collectUnknownInteractionKinds(value: Record<string, unknown>): AssessmentIssue[] {
  if (!Array.isArray(value.blocks)) return [];

  const issues: AssessmentIssue[] = [];
  value.blocks.forEach((block, blockIndex) => {
    if (!isRecord(block) || block.kind !== 'interaction' || !isRecord(block.interaction)) return;

    const kind = block.interaction.kind;
    if (typeof kind === 'string' && !KNOWN_INTERACTION_KINDS.has(kind)) {
      issues.push(
        assessmentIssue(
          'UNSUPPORTED_INTERACTION_KIND',
          ['blocks', blockIndex, 'interaction', 'kind'],
          `Interaction kind "${kind}" is not supported by schema version 1`
        )
      );
    }
  });

  return issues;
}

/** Cross-field consistency rules that Zod field schemas cannot express. */
function collectConsistencyIssues(definition: AssessmentItemDefinition): AssessmentIssue[] {
  const issues: AssessmentIssue[] = [];

  const seenBlockIds = new Set<string>();
  definition.blocks.forEach((block, blockIndex) => {
    if (seenBlockIds.has(block.id)) {
      issues.push(
        assessmentIssue('DUPLICATE_BLOCK_ID', ['blocks', blockIndex, 'id'], `Duplicate block id "${block.id}"`)
      );
    }
    seenBlockIds.add(block.id);
  });

  const interactionBlocks = getAssessmentInteractionBlocks(definition);
  if (interactionBlocks.length === 0) {
    issues.push(assessmentIssue('MALFORMED_DEFINITION', ['blocks'], 'An item requires at least one interaction block'));
  }
  if (interactionBlocks.length > MAX_ASSESSMENT_INTERACTIONS) {
    issues.push(
      assessmentIssue(
        'MALFORMED_DEFINITION',
        ['blocks'],
        `An item supports at most ${MAX_ASSESSMENT_INTERACTIONS} interactions`
      )
    );
  }

  const feedbackIds = definition.feedback.map((feedback) => feedback.id);
  if (!isUnique(feedbackIds)) {
    issues.push(assessmentIssue('MALFORMED_DEFINITION', ['feedback'], 'Feedback ids must be unique'));
  }

  definition.blocks.forEach((block, blockIndex) => {
    if (block.kind !== 'interaction') return;

    const configPath = ['blocks', blockIndex, 'interaction', 'config'];
    const interaction = block.interaction;

    if (interaction.kind === 'choice') {
      const optionIds = interaction.config.options.map((option) => option.id);
      if (!isUnique(optionIds)) {
        issues.push(assessmentIssue('MALFORMED_DEFINITION', [...configPath, 'options'], 'Option ids must be unique'));
      }
      if (!isUnique(interaction.config.correctOptionIds)) {
        issues.push(
          assessmentIssue('MALFORMED_DEFINITION', [...configPath, 'correctOptionIds'], 'Correct ids must be unique')
        );
      }
      const optionIdSet = new Set(optionIds);
      if (!interaction.config.correctOptionIds.every((correctId) => optionIdSet.has(correctId))) {
        issues.push(
          assessmentIssue(
            'MALFORMED_DEFINITION',
            [...configPath, 'correctOptionIds'],
            'Correct ids must reference declared options'
          )
        );
      }
    }

    if (interaction.kind === 'ordering') {
      if (!isUnique(interaction.config.options.map((option) => option.id))) {
        issues.push(assessmentIssue('MALFORMED_DEFINITION', [...configPath, 'options'], 'Option ids must be unique'));
      }
      if (!isUnique(interaction.config.correctOrder)) {
        issues.push(
          assessmentIssue('MALFORMED_DEFINITION', [...configPath, 'correctOrder'], 'Order entries must be unique')
        );
      }
    }

    if (
      interaction.kind === 'text' &&
      interaction.config.minCharacters !== undefined &&
      interaction.config.maxCharacters !== undefined &&
      interaction.config.maxCharacters < interaction.config.minCharacters
    ) {
      issues.push(
        assessmentIssue(
          'MALFORMED_DEFINITION',
          [...configPath, 'maxCharacters'],
          'maxCharacters cannot be below minCharacters'
        )
      );
    }

    if (
      interaction.kind === 'star_rating' &&
      interaction.config.correctValue !== null &&
      interaction.config.correctValue > interaction.config.maxStars
    ) {
      issues.push(
        assessmentIssue('MALFORMED_DEFINITION', [...configPath, 'correctValue'], 'correctValue cannot exceed maxStars')
      );
    }
  });

  return issues;
}

/**
 * Structural trust-boundary parser for schema-version-1 definitions.
 * Accepts every deterministic legacy-adapter output for valid rows; strict
 * author rules live in {@link validateAssessmentItemForPublish}.
 */
export function parseAssessmentItemDefinition(value: unknown): AssessmentResult<AssessmentItemDefinition> {
  if (!isRecord(value)) {
    return assessmentFailure([assessmentIssue('MALFORMED_DEFINITION', [], 'Definition must be an object')]);
  }

  if (value.schemaVersion !== 1) {
    return assessmentFailure([
      assessmentIssue(
        'UNSUPPORTED_SCHEMA_VERSION',
        ['schemaVersion'],
        `Unsupported definition schema version: ${String(value.schemaVersion)}`
      )
    ]);
  }

  const unknownKindIssues = collectUnknownInteractionKinds(value);
  if (unknownKindIssues.length > 0) {
    return assessmentFailure(unknownKindIssues);
  }

  const parsed = assessmentItemDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    const issues = zodIssuesToAssessmentIssues(parsed.error, (path) =>
      path[path.length - 1] === 'maxScore' ? 'INVALID_SCORE' : 'MALFORMED_DEFINITION'
    );
    return assessmentFailure(issues);
  }

  const consistencyIssues = collectConsistencyIssues(parsed.data);
  if (consistencyIssues.length > 0) {
    return assessmentFailure(consistencyIssues);
  }

  return assessmentSuccess(parsed.data);
}

function collectPublishIssues(
  interaction: AssessmentInteraction,
  configPath: Array<string | number>
): AssessmentIssue[] {
  const issues: AssessmentIssue[] = [];
  const violation = (path: Array<string | number>, message: string) =>
    issues.push(assessmentIssue('PUBLISH_RULE_VIOLATION', path, message));

  switch (interaction.kind) {
    case 'choice': {
      const { options, correctOptionIds, cardinality, presentation } = interaction.config;
      if (options.length < 2) violation([...configPath, 'options'], 'Choice needs at least two options');
      if (correctOptionIds.length === 0) {
        violation([...configPath, 'correctOptionIds'], 'Choice needs at least one correct option');
      }
      if (cardinality === 'single' && correctOptionIds.length > 1) {
        violation([...configPath, 'correctOptionIds'], 'Single choice allows exactly one correct option');
      }
      if (presentation === 'true_false') {
        const optionIds = options.map((option) => option.id).sort();
        if (optionIds.length !== 2 || optionIds[0] !== 'false' || optionIds[1] !== 'true') {
          violation([...configPath, 'options'], 'True/false presentation requires exactly the true and false options');
        }
      }
      break;
    }
    case 'numeric':
      if (interaction.config.correctValue === null) {
        violation([...configPath, 'correctValue'], 'Numeric interactions need a correct value');
      }
      break;
    case 'star_rating':
      if (interaction.config.correctValue === null) {
        violation([...configPath, 'correctValue'], 'Star rating interactions need a correct value');
      }
      break;
    case 'fill_blank':
      if (interaction.config.acceptedAnswers.length === 0) {
        violation([...configPath, 'acceptedAnswers'], 'Fill in the blank needs at least one accepted answer');
      }
      break;
    case 'word_bank': {
      const blankCount = (interaction.config.template.match(WORD_BANK_BLANK_PATTERN) ?? []).length;
      if (blankCount < 1) {
        violation([...configPath, 'template'], 'Word bank templates need at least one ___ blank');
      } else if (interaction.config.correctAnswers.length < blankCount) {
        violation([...configPath, 'correctAnswers'], 'Provide a correct answer for each blank');
      }
      break;
    }
    case 'ordering': {
      const optionIds = interaction.config.options.map((option) => option.id);
      if (optionIds.length < 2) {
        violation([...configPath, 'options'], 'Ordering needs at least two options');
      } else if (!isExactStringPermutation(interaction.config.correctOrder, optionIds)) {
        violation([...configPath, 'correctOrder'], 'Correct order must be an exact permutation of the options');
      }
      break;
    }
    case 'text':
    case 'file_upload':
    case 'link':
    case 'video_recording':
      break;
  }

  return issues;
}

/**
 * Author-facing publish gate (FR-10). Runs on an already-parsed definition and
 * applies rules that legacy database rows may legitimately violate.
 */
export function validateAssessmentItemForPublish(
  definition: AssessmentItemDefinition
): AssessmentResult<AssessmentItemDefinition> {
  const issues: AssessmentIssue[] = [];

  definition.blocks.forEach((block, blockIndex) => {
    if (block.kind !== 'interaction') return;

    issues.push(...collectPublishIssues(block.interaction, ['blocks', blockIndex, 'interaction', 'config']));
  });

  return issues.length > 0 ? assessmentFailure(issues) : assessmentSuccess(definition);
}
