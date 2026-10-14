import { createHash } from 'node:crypto';

import type { AssessmentDeliveryBlock } from '@cio/question-types';

import type { ExamSittingPaper, ExamSittingQuestion } from './exam-paper-serializer';

export type ShuffleSwitches = { questions: boolean; options: boolean };

const POINTS_AT_OTHER_OPTIONS =
  /tất cả|cả hai|cả ba|cả bốn|cả [a-f] và [a-f]|các (đáp án|ý|câu|phương án) trên|không có (đáp án|ý|câu|phương án)|all of the above|none of the above|both [a-f] and [a-f]|both of the above/i;

function seededRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = items.slice();

  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }

  return result;
}

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function isSectionHeading(question: ExamSittingQuestion): boolean {
  return !question.definition.blocks.some((block) => block.kind === 'interaction');
}

function shuffleWithinSections(questions: ExamSittingQuestion[], random: () => number): ExamSittingQuestion[] {
  const result: ExamSittingQuestion[] = [];
  let section: ExamSittingQuestion[] = [];

  for (const question of questions) {
    if (isSectionHeading(question)) {
      result.push(...shuffled(section, random), question);
      section = [];
    } else {
      section.push(question);
    }
  }

  return [...result, ...shuffled(section, random)];
}

function shuffleBlockOptions(block: AssessmentDeliveryBlock, random: () => number): AssessmentDeliveryBlock {
  if (block.kind !== 'interaction' || block.interaction.kind !== 'choice') return block;

  const { config } = block.interaction;
  if (config.presentation !== 'list') return block;
  if (config.options.some((option) => POINTS_AT_OTHER_OPTIONS.test(plainText(option.html)))) return block;

  return {
    ...block,
    interaction: { ...block.interaction, config: { ...config, options: shuffled(config.options, random) } }
  };
}

export function shufflePaper(paper: ExamSittingPaper, seed: string, switches: ShuffleSwitches): ExamSittingPaper {
  if (!switches.questions && !switches.options) return paper;

  const random = seededRandom(seed);
  const ordered = switches.questions ? shuffleWithinSections(paper.questions, random) : paper.questions;

  return {
    ...paper,
    questions: ordered.map((question, index) => ({
      ...question,
      order: index + 1,
      definition: switches.options
        ? {
            ...question.definition,
            blocks: question.definition.blocks.map((block) => shuffleBlockOptions(block, random))
          }
        : question.definition
    }))
  };
}
