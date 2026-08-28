/**
 * Naming the paper this device already has open, so its owner can recognise it.
 *
 * The question the card asks is "is this yours?", and a card that cannot say whose it is
 * cannot be answered. A name is the usual answer, but an exam is free not to ask for one:
 * `requiresName`, `requiresClass` and `requiresCandidateNumber` are each per-exam, so every
 * identifying field here is genuinely optional and the fallback has to keep working when
 * they are all absent.
 *
 * The last fallback is the time the paper was started. It identifies nobody, which is the
 * point — it is still something the holder knows about their own morning, and it is what
 * remains true when the exam asked for nothing at all.
 */

export type ResumeOwner = {
  displayName?: string | null;
  nickname?: string | null;
  className?: string | null;
  candidateNumber?: string | null;
  startedAt?: string | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

/**
 * The strongest identity the attempt carries, or `null` when it carries none.
 *
 * A nickname joins the name rather than replacing it: the nickname exists precisely because
 * two people in one class share a name, so dropping either half loses the distinction it
 * was typed to make.
 */
export function resumeOwnerName(owner: ResumeOwner): string | null {
  const name = clean(owner.displayName);
  const nickname = clean(owner.nickname);

  if (name && nickname) return `${name} (${nickname})`;
  if (name) return name;
  if (nickname) return nickname;

  return null;
}

/**
 * The supporting details, in the order a candidate checks them: their class, then their
 * candidate number. Absent fields are left out rather than written as a blank.
 */
export function resumeOwnerDetails(owner: ResumeOwner): string[] {
  const details: string[] = [];

  const className = clean(owner.className);
  const candidateNumber = clean(owner.candidateNumber);

  if (className) details.push(className);
  if (candidateNumber) details.push(candidateNumber);

  return details;
}

/**
 * The wall-clock time the paper was started, in Vietnam time and to the minute.
 *
 * Named rather than assumed: the candidate is reading their own morning off a school clock,
 * not the browser's idea of a timezone, and the two disagree the moment a device is set
 * wrong — which on a borrowed phone is exactly the case in hand.
 */
export function resumeStartedAtLabel(startedAt: string | null | undefined): string | null {
  if (!startedAt) return null;

  const at = new Date(startedAt);
  if (Number.isNaN(at.getTime())) return null;

  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh'
  }).format(at);
}
