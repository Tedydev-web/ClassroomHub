export type AttemptLinkSignal = 'device' | 'device_likely' | 'network';

export type AttemptLinkInput = {
  attemptId: string;
  examId: string;
  displayName: string | null;
  startedAt: string;
  submittedAt: string | null;
  deviceHash: string | null;
  fingerprintHash: string | null;
  ipHash: string | null;
};

export type AttemptLink = {
  attemptId: string;
  displayName: string | null;
  startedAt: string;
  submittedAt: string | null;
  signal: AttemptLinkSignal;
};

export type AttemptLinkage = {
  links: AttemptLink[];
  startedAfterSubmitOf: {
    attemptId: string;
    displayName: string | null;
    minutes: number;
    signal: AttemptLinkSignal;
  } | null;
};

export const QUICK_RETAKE_MINUTES = 30;

const SIGNAL_RANK: Record<AttemptLinkSignal, number> = { device: 0, device_likely: 1, network: 2 };

function sharedSignal(a: AttemptLinkInput, b: AttemptLinkInput): AttemptLinkSignal | null {
  if (a.deviceHash && a.deviceHash === b.deviceHash) return 'device';
  if (a.ipHash && a.ipHash === b.ipHash) {
    return a.fingerprintHash && a.fingerprintHash === b.fingerprintHash ? 'device_likely' : 'network';
  }
  return null;
}

function retakeOf(attempt: AttemptLinkInput, links: AttemptLink[]): AttemptLinkage['startedAfterSubmitOf'] {
  const started = new Date(attempt.startedAt).getTime();
  let nearest: AttemptLinkage['startedAfterSubmitOf'] = null;

  for (const link of links) {
    if (!link.submittedAt) continue;

    const minutes = Math.round((started - new Date(link.submittedAt).getTime()) / 60_000);
    if (minutes < 0 || minutes > QUICK_RETAKE_MINUTES) continue;
    if (nearest && nearest.minutes <= minutes) continue;

    nearest = { attemptId: link.attemptId, displayName: link.displayName, minutes, signal: link.signal };
  }

  return nearest;
}

export function linkAttempts(rows: AttemptLinkInput[]): Map<string, AttemptLinkage> {
  const byExam = new Map<string, AttemptLinkInput[]>();
  for (const row of rows) byExam.set(row.examId, [...(byExam.get(row.examId) ?? []), row]);

  const result = new Map<string, AttemptLinkage>();

  for (const attempts of byExam.values()) {
    for (const attempt of attempts) {
      const links: AttemptLink[] = [];

      for (const other of attempts) {
        if (other.attemptId === attempt.attemptId) continue;

        const signal = sharedSignal(attempt, other);
        if (!signal) continue;

        links.push({
          attemptId: other.attemptId,
          displayName: other.displayName,
          startedAt: other.startedAt,
          submittedAt: other.submittedAt,
          signal
        });
      }

      links.sort((a, b) => SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal]);
      result.set(attempt.attemptId, { links, startedAfterSubmitOf: retakeOf(attempt, links) });
    }
  }

  return result;
}
