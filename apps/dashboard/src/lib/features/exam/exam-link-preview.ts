/**
 * What a chat app shows when a teacher pastes an exam link.
 *
 * A link to a paper was previewing as the product's own marketing: the platform logo, the
 * platform tagline, and no sign of which exam it was. A class receives that in a group chat
 * and has to open it to learn whether it is theirs, when it opens, and how long they get.
 *
 * Nothing here is a new disclosure. The link is the credential; anybody holding it can
 * already read every one of these on the page it opens. What changes is that they can read
 * it without opening it, which is the whole point of a preview.
 */

export type ExamPreviewFacts = {
  title: string;
  course: string | null;
  opensAt: string | null;
  closesAt: string | null;
  workingSeconds: number | null;
  questionCount: number;
  requiresPassword: boolean;
};

/**
 * Vietnam time, named rather than assumed.
 *
 * A preview is rendered once by whichever service scraped the link, on a server whose clock
 * and locale are its own, and then cached — so it cannot be shown in the reader's local
 * time and must not silently be shown in the scraper's. Both ends of the window belong to
 * the school day this exam sits in.
 */
const ZONE = 'Asia/Ho_Chi_Minh';

function moment(value: string | null): string | null {
  if (!value) return null;

  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;

  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONE
  }).format(at);
}

/**
 * One line, in the order somebody reading it in a hurry needs: when it opens, when it
 * shuts, how long they have, how many questions, and whether they will be asked for a
 * password. Parts with nothing to say are left out rather than written as "none".
 */
export function examPreviewDescription(exam: ExamPreviewFacts): string {
  const parts: string[] = [];

  const opens = moment(exam.opensAt);
  const closes = moment(exam.closesAt);

  if (opens) parts.push(`Mở ${opens}`);
  if (closes) parts.push(`Đóng ${closes}`);

  if (exam.workingSeconds) parts.push(`Làm bài ${Math.round(exam.workingSeconds / 60)} phút`);
  if (exam.questionCount > 0) parts.push(`${exam.questionCount} câu`);
  if (exam.requiresPassword) parts.push('Cần mật khẩu');

  // A paper with no window and no clock still deserves a sentence rather than an empty one.
  return parts.length > 0 ? parts.join(' · ') : 'Bấm vào liên kết để bắt đầu làm bài.';
}

/** The exam's name, with the course behind it where it has one. */
export function examPreviewTitle(exam: ExamPreviewFacts): string {
  return exam.course ? `${exam.title} · ${exam.course}` : exam.title;
}
