import { describe, expect, it } from 'vitest';

import { examPreviewDescription, examPreviewTitle, type ExamPreviewFacts } from './exam-link-preview';

const paper = (overrides: Partial<ExamPreviewFacts> = {}): ExamPreviewFacts => ({
  title: 'Đề thi thử THPT 2026',
  course: 'Tiếng Anh 12',
  opensAt: '2026-08-28T01:00:00.000Z',
  closesAt: '2026-08-31T10:30:00.000Z',
  workingSeconds: 3600,
  questionCount: 40,
  requiresPassword: false,
  ...overrides
});

describe('what a chat app shows for an exam link', () => {
  it('names the exam, and the course behind it', () => {
    expect(examPreviewTitle(paper())).toBe('Đề thi thử THPT 2026 · Tiếng Anh 12');
  });

  it('names only the exam where it belongs to no course', () => {
    expect(examPreviewTitle(paper({ course: null }))).toBe('Đề thi thử THPT 2026');
  });

  it('reads the window in Vietnam time, not the scraper time', () => {
    // 01:00 UTC is 08:00 in Ho Chi Minh City, and a preview rendered on a server in another
    // zone must still say the hour the class will sit down.
    const description = examPreviewDescription(paper());

    expect(description).toContain('Mở 08:00 28/08/2026');
    expect(description).toContain('Đóng 17:30 31/08/2026');
  });

  it('says how long and how many', () => {
    expect(examPreviewDescription(paper())).toContain('Làm bài 60 phút');
    expect(examPreviewDescription(paper())).toContain('40 câu');
  });

  it('warns about a password so nobody arrives without one', () => {
    expect(examPreviewDescription(paper({ requiresPassword: true }))).toContain('Cần mật khẩu');
    expect(examPreviewDescription(paper())).not.toContain('Cần mật khẩu');
  });

  it('leaves out what the exam does not have rather than writing "none"', () => {
    const description = examPreviewDescription(
      paper({ opensAt: null, closesAt: null, workingSeconds: null, questionCount: 0 })
    );

    expect(description).toBe('Bấm vào liên kết để bắt đầu làm bài.');
  });

  it('ignores a date the server could not parse', () => {
    const description = examPreviewDescription(paper({ opensAt: 'not a date', closesAt: null }));

    expect(description).not.toContain('Mở');
    expect(description).toContain('40 câu');
  });
});
