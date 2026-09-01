import type { ActivityEvent } from './exam-activity';

/**
 * Events that have happened but have not been accepted by the server yet.
 *
 * A departure is reported at the moment the paper stops being the visible window — which is
 * the moment a browser is most willing to throttle or drop the request that reports it, and
 * the moment a deploy restarting the API would sever it. The report was fire-and-forget: a
 * failed send dropped its events, and the code said the next report would carry the count.
 * It would not. Each report only ever carried what it was handed, so a departure that failed
 * to arrive was gone — from an anti-cheat record, which exists precisely to be complete.
 *
 * So an unsent event is kept and offered again with the next report and on a timer. The log
 * is append-only and every event carries its own timestamp, so arriving late costs nothing:
 * the record reads the same whether it took one attempt or twenty.
 */

/**
 * Far more departures than any real sitting produces.
 *
 * A cap exists so a page left open against a server that never answers cannot grow without
 * bound. It is set where it can only be reached by a fault, not by a candidate: a paper with
 * two hundred unsent departures has a problem the cap is not going to fix.
 */
export const MAX_PENDING_ACTIVITY = 200;

/**
 * What the next report should carry: what failed before, then what just happened.
 *
 * Order is the order things occurred, because a reader of the log is reading a sequence.
 * The oldest are dropped first when the cap bites — a recent departure is the one somebody
 * is about to ask about.
 */
export function queueActivity(pending: ActivityEvent[], incoming: ActivityEvent[]): ActivityEvent[] {
  const merged = [...pending, ...incoming];

  return merged.length <= MAX_PENDING_ACTIVITY ? merged : merged.slice(merged.length - MAX_PENDING_ACTIVITY);
}

/**
 * What is still owed after a report, given what that report tried to send.
 *
 * A send that succeeded clears exactly what it carried, and nothing else: an event that
 * happened while the request was in flight has not been sent by anybody and must survive.
 * Compared by kind and timestamp rather than by identity, because the array handed to the
 * request is not the array that comes back to this.
 */
export function settleActivity(pending: ActivityEvent[], sent: ActivityEvent[]): ActivityEvent[] {
  const delivered = new Set(sent.map((event) => `${event.kind}@${event.at}`));

  return pending.filter((event) => !delivered.has(`${event.kind}@${event.at}`));
}
