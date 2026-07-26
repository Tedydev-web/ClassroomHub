import type {
  ExamImportAnswerSource,
  ExamImportConfidence,
  ExamImportDiagnostic,
  ExamImportDraft,
  ExamImportFieldState,
  ExamImportQuestion,
  ExamImportSourceSpan
} from './exam-import-draft';
import {
  MAX_EXAM_IMPORT_PROVENANCE_SPANS,
  boundExamImportDiagnostics,
  examImportDraftSchema
} from './exam-import-draft';

type CandidateRecord = {
  id: string;
  source: ExamImportAnswerSource;
  identity: string;
  provenance: ExamImportSourceSpan[];
};

type Resolution = {
  selectedCandidateIds: string[];
  conflictingCandidateIds: string[];
  confidence: ExamImportConfidence;
  origin: ExamImportFieldState['origin'] | null;
  status: 'missing' | 'resolved' | 'unresolved_conflict';
  resolvedBy: 'teacher' | 'answer_table' | 'deterministic' | 'ai' | null;
};

const RECONCILIATION_DIAGNOSTIC_CODES = new Set([
  'ANSWER_KEY_MISSING',
  'ANSWER_SOURCE_CONFLICT',
  'ANSWER_SOURCE_CONFLICT_UNRESOLVED',
  'AI_ANSWER_PROPOSED'
]);

const confidenceRank = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  teacher_confirmed: 4
} as const;

const confidenceByRank: Record<number, ExamImportConfidence> = {
  0: 'none',
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'teacher_confirmed'
};

function sortedIdentity(values: readonly string[]): string {
  return [...values].sort().join('\u0000');
}

function booleanAnswerIdentity(answers: readonly { statementId: string; correctValue: boolean }[]): string {
  return [...answers]
    .sort((left, right) => left.statementId.localeCompare(right.statementId))
    .map((answer) => `${answer.statementId}:${answer.correctValue ? '1' : '0'}`)
    .join('\u0000');
}

function candidateRecords(question: ExamImportQuestion): CandidateRecord[] {
  switch (question.kind) {
    case 'choice':
      return question.answerCandidates.map((candidate) => ({
        id: candidate.id,
        source: candidate.source,
        identity: sortedIdentity(candidate.correctOptionIds),
        provenance: candidate.provenance
      }));
    case 'true_false_group':
      return question.answerCandidates.map((candidate) => ({
        id: candidate.id,
        source: candidate.source,
        identity: booleanAnswerIdentity(candidate.answers),
        provenance: candidate.provenance
      }));
    case 'short_answer':
      return question.answerCandidates.map((candidate) => ({
        id: candidate.id,
        source: candidate.source,
        identity: sortedIdentity(
          candidate.acceptedAnswers.map((answer) => answer.normalize('NFC').trim().toLowerCase())
        ),
        provenance: candidate.provenance
      }));
    case 'numeric':
      return question.answerCandidates.map((candidate) => ({
        id: candidate.id,
        source: candidate.source,
        identity: `${candidate.value}:${candidate.tolerance ?? 'null'}`,
        provenance: candidate.provenance
      }));
    case 'essay':
    case 'unresolved':
      return [];
  }

  question satisfies never;
  return [];
}

function uniqueIdentities(candidates: readonly CandidateRecord[]): Set<string> {
  return new Set(candidates.map((candidate) => candidate.identity));
}

function resolved(
  candidates: readonly CandidateRecord[],
  winningIdentity: string,
  confidence: ExamImportConfidence,
  origin: ExamImportFieldState['origin'],
  resolvedBy: NonNullable<Resolution['resolvedBy']>
): Resolution {
  return {
    selectedCandidateIds: candidates
      .filter((candidate) => candidate.identity === winningIdentity)
      .map((candidate) => candidate.id),
    conflictingCandidateIds: candidates
      .filter((candidate) => candidate.identity !== winningIdentity)
      .map((candidate) => candidate.id),
    confidence,
    origin,
    status: 'resolved',
    resolvedBy
  };
}

function resolveCandidates(candidates: readonly CandidateRecord[]): Resolution {
  if (candidates.length === 0) {
    return {
      selectedCandidateIds: [],
      conflictingCandidateIds: [],
      confidence: 'none',
      origin: null,
      status: 'missing',
      resolvedBy: null
    };
  }

  const teacherCandidates = candidates.filter((candidate) => candidate.source === 'teacher');
  const teacherIdentities = uniqueIdentities(teacherCandidates);
  if (teacherIdentities.size === 1) {
    return resolved(candidates, [...teacherIdentities][0]!, 'teacher_confirmed', 'teacher', 'teacher');
  }
  if (teacherIdentities.size > 1) {
    return {
      selectedCandidateIds: [],
      conflictingCandidateIds: candidates.map((candidate) => candidate.id),
      confidence: 'none',
      origin: null,
      status: 'unresolved_conflict',
      resolvedBy: null
    };
  }

  const deterministicCandidates = candidates.filter((candidate) => candidate.source !== 'ai');
  const deterministicIdentities = uniqueIdentities(deterministicCandidates);
  if (deterministicIdentities.size === 1) {
    const winningIdentity = [...deterministicIdentities][0]!;
    const conflictingCandidates = candidates.filter((candidate) => candidate.identity !== winningIdentity);
    const agreeingDeterministicSources = new Set(
      deterministicCandidates
        .filter((candidate) => candidate.identity === winningIdentity)
        .map((candidate) => candidate.source)
    );
    const confidence =
      conflictingCandidates.length > 0 ? 'low' : agreeingDeterministicSources.size > 1 ? 'high' : 'medium';

    return resolved(candidates, winningIdentity, confidence, 'deterministic', 'deterministic');
  }

  if (deterministicIdentities.size > 1) {
    const answerTableCandidates = deterministicCandidates.filter((candidate) => candidate.source === 'answer_table');
    const answerTableIdentities = uniqueIdentities(answerTableCandidates);
    if (answerTableIdentities.size === 1) {
      return resolved(candidates, [...answerTableIdentities][0]!, 'low', 'deterministic', 'answer_table');
    }

    return {
      selectedCandidateIds: [],
      conflictingCandidateIds: candidates.map((candidate) => candidate.id),
      confidence: 'none',
      origin: null,
      status: 'unresolved_conflict',
      resolvedBy: null
    };
  }

  const aiIdentities = uniqueIdentities(candidates);
  if (aiIdentities.size === 1) {
    return resolved(candidates, [...aiIdentities][0]!, 'low', 'ai', 'ai');
  }

  return {
    selectedCandidateIds: [],
    conflictingCandidateIds: candidates.map((candidate) => candidate.id),
    confidence: 'none',
    origin: null,
    status: 'unresolved_conflict',
    resolvedBy: null
  };
}

function agreementFor(resolution: Resolution, records: readonly CandidateRecord[]) {
  if (resolution.conflictingCandidateIds.length > 0) return 'conflict' as const;

  const selectedSources = new Set(
    records
      .filter((candidate) => resolution.selectedCandidateIds.includes(candidate.id))
      .map((candidate) => candidate.source)
  );

  return selectedSources.size > 1 ? ('unanimous' as const) : ('single_source' as const);
}

function applyResolution(question: ExamImportQuestion, resolution: Resolution): ExamImportQuestion {
  const records = candidateRecords(question);
  const agreement = agreementFor(resolution, records);
  const selectedId = resolution.selectedCandidateIds[0];

  if (resolution.status !== 'resolved' || selectedId === undefined) {
    if (question.kind === 'essay' || question.kind === 'unresolved') return question;

    return { ...question, answerKey: null, confidence: 'none', review: 'unresolved' };
  }

  switch (question.kind) {
    case 'choice': {
      const candidate = question.answerCandidates.find((item) => item.id === selectedId);
      if (!candidate) return { ...question, answerKey: null, confidence: 'none', review: 'unresolved' };

      return {
        ...question,
        answerKey: {
          kind: 'choice',
          correctOptionIds: [...candidate.correctOptionIds],
          agreement,
          selectedCandidateIds: resolution.selectedCandidateIds,
          conflictingCandidateIds: resolution.conflictingCandidateIds
        },
        confidence: resolution.confidence,
        review:
          resolution.confidence === 'low' || resolution.conflictingCandidateIds.length > 0 ? 'needs_attention' : 'clean'
      };
    }
    case 'true_false_group': {
      const candidate = question.answerCandidates.find((item) => item.id === selectedId);
      if (!candidate) return { ...question, answerKey: null, confidence: 'none', review: 'unresolved' };

      return {
        ...question,
        answerKey: {
          kind: 'true_false_group',
          answers: candidate.answers.map((answer) => ({ ...answer })),
          agreement,
          selectedCandidateIds: resolution.selectedCandidateIds,
          conflictingCandidateIds: resolution.conflictingCandidateIds
        },
        confidence: resolution.confidence,
        review:
          resolution.confidence === 'low' || resolution.conflictingCandidateIds.length > 0 ? 'needs_attention' : 'clean'
      };
    }
    case 'short_answer': {
      const candidate = question.answerCandidates.find((item) => item.id === selectedId);
      if (!candidate) return { ...question, answerKey: null, confidence: 'none', review: 'unresolved' };

      return {
        ...question,
        answerKey: {
          kind: 'short_answer',
          acceptedAnswers: [...candidate.acceptedAnswers],
          agreement,
          selectedCandidateIds: resolution.selectedCandidateIds,
          conflictingCandidateIds: resolution.conflictingCandidateIds
        },
        confidence: resolution.confidence,
        review:
          resolution.confidence === 'low' || resolution.conflictingCandidateIds.length > 0 ? 'needs_attention' : 'clean'
      };
    }
    case 'numeric': {
      const candidate = question.answerCandidates.find((item) => item.id === selectedId);
      if (!candidate) return { ...question, answerKey: null, confidence: 'none', review: 'unresolved' };

      return {
        ...question,
        answerKey: {
          kind: 'numeric',
          value: candidate.value,
          tolerance: candidate.tolerance,
          agreement,
          selectedCandidateIds: resolution.selectedCandidateIds,
          conflictingCandidateIds: resolution.conflictingCandidateIds
        },
        confidence: resolution.confidence,
        review:
          resolution.confidence === 'low' || resolution.conflictingCandidateIds.length > 0 ? 'needs_attention' : 'clean'
      };
    }
    case 'essay':
    case 'unresolved':
      return question;
  }

  question satisfies never;
  return question;
}

function uniqueProvenance(candidates: readonly CandidateRecord[], selectedCandidateIds: readonly string[]) {
  const spans = candidates
    .filter((candidate) => selectedCandidateIds.includes(candidate.id))
    .flatMap((candidate) => candidate.provenance);
  const seen = new Set<string>();

  const unique = spans.filter((span) => {
    const identity = JSON.stringify(span);
    if (seen.has(identity)) return false;
    seen.add(identity);

    return true;
  });

  return unique.slice(0, MAX_EXAM_IMPORT_PROVENANCE_SPANS);
}

function answerFieldState(
  question: ExamImportQuestion,
  resolution: Resolution,
  records: readonly CandidateRecord[]
): ExamImportFieldState | null {
  if (resolution.status !== 'resolved' || resolution.origin === null) return null;

  const provenance = uniqueProvenance(records, resolution.selectedCandidateIds);
  if (provenance.length === 0) return null;

  return {
    target: { kind: 'question_field', questionId: question.id, field: 'answerKey' },
    confidence: resolution.confidence,
    origin: resolution.origin,
    provenance
  };
}

function reconciliationDiagnostic(code: string, message: string, question: ExamImportQuestion): ExamImportDiagnostic {
  return {
    tier: 'semantic',
    severity: 'error',
    blocking: true,
    code,
    message,
    messageKey: `exam_import.diagnostics.${code.toLowerCase()}`,
    questionId: question.id,
    target: { kind: 'question_field', questionId: question.id, field: 'answerKey' },
    provenance: question.provenance
  };
}

function reconciliationDiagnostics(question: ExamImportQuestion, resolution: Resolution): ExamImportDiagnostic[] {
  if (question.kind === 'essay' || question.kind === 'unresolved') return [];
  if (resolution.status === 'missing') {
    return [reconciliationDiagnostic('ANSWER_KEY_MISSING', 'No answer-key source was found', question)];
  }
  if (resolution.status === 'unresolved_conflict') {
    return [
      reconciliationDiagnostic(
        'ANSWER_SOURCE_CONFLICT_UNRESOLVED',
        'Answer sources conflict and no authoritative source can resolve them',
        question
      )
    ];
  }
  if (resolution.resolvedBy === 'teacher') return [];
  if (resolution.resolvedBy === 'ai') {
    return [
      reconciliationDiagnostic('AI_ANSWER_PROPOSED', 'AI-proposed answer requires teacher confirmation', question)
    ];
  }
  if (resolution.conflictingCandidateIds.length > 0) {
    return [
      reconciliationDiagnostic(
        'ANSWER_SOURCE_CONFLICT',
        'Answer sources conflict; the authoritative candidate was retained for review',
        question
      )
    ];
  }

  return [];
}

function aggregateQuestionConfidence(
  question: ExamImportQuestion,
  fieldStates: readonly ExamImportFieldState[],
  fallback: ExamImportConfidence
): ExamImportConfidence {
  const relevantStates = fieldStates.filter((fieldState) => {
    switch (fieldState.target.kind) {
      case 'question_field':
      case 'option_field':
      case 'statement_field':
        return fieldState.target.questionId === question.id;
      case 'draft_field':
      case 'shared_content_field':
      case 'section_field':
        return false;
    }
  });
  const rank = relevantStates.reduce<number>(
    (lowest, fieldState) => Math.min(lowest, confidenceRank[fieldState.confidence]),
    confidenceRank[fallback]
  );

  return confidenceByRank[rank] ?? 'none';
}

export function reconcileExamImportDraftAnswers(draft: ExamImportDraft): ExamImportDraft {
  const parsedDraft = examImportDraftSchema.parse(structuredClone(draft));
  const existingFieldStates = parsedDraft.fieldStates.filter(
    (fieldState) => !(fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey')
  );
  const fieldStates = [...existingFieldStates];
  const diagnostics = parsedDraft.diagnostics.filter(
    (diagnostic) => !RECONCILIATION_DIAGNOSTIC_CODES.has(diagnostic.code)
  );

  const sections = parsedDraft.sections.map((section) => ({
    ...section,
    questions: section.questions.map((question): ExamImportQuestion => {
      if (question.kind === 'essay' || question.kind === 'unresolved') return question;

      const records = candidateRecords(question);
      const resolution = resolveCandidates(records);
      const reconciledQuestion = applyResolution(question, resolution);
      if (reconciledQuestion.kind === 'essay' || reconciledQuestion.kind === 'unresolved') {
        return reconciledQuestion;
      }

      const state = answerFieldState(reconciledQuestion, resolution, records);
      if (state) fieldStates.push(state);
      diagnostics.push(...reconciliationDiagnostics(reconciledQuestion, resolution));

      const confidence =
        resolution.status === 'resolved'
          ? aggregateQuestionConfidence(reconciledQuestion, fieldStates, resolution.confidence)
          : 'none';
      const hasQuestionDiagnostic = diagnostics.some((diagnostic) => diagnostic.questionId === reconciledQuestion.id);
      const review: ExamImportQuestion['review'] =
        resolution.status !== 'resolved'
          ? 'unresolved'
          : hasQuestionDiagnostic ||
              (resolution.resolvedBy !== 'teacher' &&
                (resolution.confidence === 'low' || resolution.conflictingCandidateIds.length > 0))
            ? 'needs_attention'
            : 'clean';

      return {
        ...reconciledQuestion,
        confidence,
        review
      };
    })
  }));

  const boundedDiagnostics = boundExamImportDiagnostics(diagnostics);

  return examImportDraftSchema.parse({ ...parsedDraft, fieldStates, sections, diagnostics: boundedDiagnostics });
}
