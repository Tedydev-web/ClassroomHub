import { summariseFocus, type ActivityEvent, type FocusSummary } from './exam-activity';

/**
 * One sitting, in the order it happened.
 *
 * The paper already stamps every answer as it is saved, and now stamps every departure. On
 * their own each is a list; together they answer the question a teacher actually has, which
 * is not "how many times did they leave" but "what did they do when they came back".
 *
 * That is the whole of what this is for, and it is worth being clear about the limit: a
 * departure followed immediately by three answers is a shape, not a finding. A student who
 * put their phone down to work on paper produces it too.
 */

export type AnswerLogEntry = {
  at: string;
  questionId: number;
  /**
   * The item's whole answer as it stood at that moment, which is what the sitting page sends
   * and the server stores verbatim. Comparing one against the previous one for the same item
   * is what turns "this item was written to" into "question 14 was answered".
   */
  answerData?: unknown;
};

export type TimelineEntry =
  | { kind: 'left'; at: string }
  | { kind: 'returned'; at: string; awaySeconds: number | null }
  | {
      kind: 'answered';
      at: string;
      questionId: number;
      /**
       * The numbers on the paper that changed at this moment. Empty where the paper cannot
       * resolve them — an item no longer on it, or a log entry too old to carry its answers.
       */
      questionNumbers: number[];
    };

export type AttemptTimeline = {
  entries: TimelineEntry[];
  focus: FocusSummary;
};

/**
 * Merges the two logs into one ordering.
 *
 * A return carries how long the absence lasted, measured against the departure it follows.
 * Where no departure precedes it — a log that begins mid-absence, a device that slept
 * through one — the duration is `null` rather than a number nobody can stand behind.
 */
/** The responses inside one stored answer, keyed by interaction. Shape-checked, not trusted. */
function responsesOf(answerData: unknown): Map<string, string> {
  const responses = (answerData as { responses?: unknown } | null)?.responses;
  if (!Array.isArray(responses)) return new Map();

  const byInteraction = new Map<string, string>();

  for (const entry of responses) {
    const interactionId = (entry as { interactionId?: unknown })?.interactionId;
    if (typeof interactionId !== 'string') continue;

    // Compared as text: the responses are small JSON values, and a stable string is enough
    // to answer "is this the same answer as a moment ago" without a deep-equality helper.
    byInteraction.set(interactionId, JSON.stringify((entry as { response?: unknown }).response ?? null));
  }

  return byInteraction;
}

export function buildAttemptTimeline(
  activityLog: ActivityEvent[] | null | undefined,
  answerLog: AnswerLogEntry[] | null | undefined,
  /** Interaction id to the number printed on the paper. Without it, numbers stay empty. */
  questionNumbers: Record<string, number> = {}
): AttemptTimeline {
  const activity = (activityLog ?? []).filter((event) => !Number.isNaN(Date.parse(event.at)));
  const answers = (answerLog ?? []).filter((entry) => entry && !Number.isNaN(Date.parse(entry.at)));

  const merged: Array<{ at: number; entry: TimelineEntry }> = [];
  let leftAt: number | null = null;

  for (const event of [...activity].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const at = Date.parse(event.at);

    if (event.kind === 'left') {
      leftAt = at;
      merged.push({ at, entry: { kind: 'left', at: event.at } });

      continue;
    }

    const awaySeconds = leftAt === null ? null : Math.max(0, Math.round((at - leftAt) / 1000));
    leftAt = null;
    merged.push({ at, entry: { kind: 'returned', at: event.at, awaySeconds } });
  }

  /**
   * What each item's answer looked like the last time it was saved.
   *
   * A save carries the item's whole answer, not the one field that changed, so the changed
   * questions are the difference between this save and the one before it. The first save of
   * an item has nothing to compare against, and every answer in it is new by definition.
   */
  const seen = new Map<number, Map<string, string>>();

  for (const entry of [...answers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const current = responsesOf(entry.answerData);
    const previous = seen.get(entry.questionId) ?? new Map<string, string>();

    const changed: number[] = [];

    for (const [interactionId, value] of current) {
      if (previous.get(interactionId) === value) continue;

      const number = questionNumbers[interactionId];
      if (number !== undefined) changed.push(number);
    }

    seen.set(entry.questionId, current);

    merged.push({
      at: Date.parse(entry.at),
      entry: {
        kind: 'answered',
        at: entry.at,
        questionId: entry.questionId,
        questionNumbers: changed.sort((a, b) => a - b)
      }
    });
  }

  // Sorted once at the end so answers and departures interleave by time rather than by
  // which list they came from.
  merged.sort((a, b) => a.at - b.at);

  return {
    entries: merged.map((item) => item.entry),
    focus: summariseFocus(activity)
  };
}
