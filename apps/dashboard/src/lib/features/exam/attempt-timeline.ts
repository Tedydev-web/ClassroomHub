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
};

export type TimelineEntry =
  | { kind: 'left'; at: string }
  | { kind: 'returned'; at: string; awaySeconds: number | null }
  | { kind: 'answered'; at: string; questionId: number };

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
export function buildAttemptTimeline(
  activityLog: ActivityEvent[] | null | undefined,
  answerLog: AnswerLogEntry[] | null | undefined
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

  for (const entry of answers) {
    merged.push({
      at: Date.parse(entry.at),
      entry: { kind: 'answered', at: entry.at, questionId: entry.questionId }
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
