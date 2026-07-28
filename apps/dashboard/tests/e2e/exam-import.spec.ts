import { Buffer } from 'node:buffer';

import { expect, test, type Page } from '@playwright/test';

const environment = process['env'];
const baseURL = environment.E2E_BASE_URL;
const email = environment.E2E_EMAIL;
const password = environment.E2E_PASSWORD;
const studentEmail = environment.E2E_STUDENT_EMAIL;
const studentPassword = environment.E2E_STUDENT_PASSWORD;
const courseId = environment.E2E_EXAM_IMPORT_COURSE_ID;
const docxPath = environment.E2E_EXAM_IMPORT_DOCX_PATH;
const pdfPath = environment.E2E_EXAM_IMPORT_PDF_PATH;
const textPdfEnabled = environment.E2E_EXAM_IMPORT_TEXT_PDF_ENABLED === 'true';
const scannedPdfEnabled = environment.E2E_EXAM_IMPORT_SCANNED_PDF_ENABLED === 'true';
const scannedPdfQuestionCountValue = environment.E2E_EXAM_IMPORT_SCANNED_PDF_QUESTION_COUNT ?? '40';
const scannedPdfQuestionCount = Number(scannedPdfQuestionCountValue);

if (!/^[1-9]\d*$/.test(scannedPdfQuestionCountValue) || !Number.isSafeInteger(scannedPdfQuestionCount)) {
  throw new Error('E2E_EXAM_IMPORT_SCANNED_PDF_QUESTION_COUNT must be a positive integer');
}

const hasBaseConfiguration = Boolean(baseURL && email && password && courseId);
const hasDocxConfiguration = Boolean(hasBaseConfiguration && docxPath);
const hasTextPdfConfiguration = Boolean(hasBaseConfiguration && textPdfEnabled);
const hasPdfConfiguration = Boolean(hasBaseConfiguration && pdfPath && scannedPdfEnabled);
const hasDistinctStudentAccount =
  Boolean(studentEmail) && studentEmail.trim().toLowerCase() !== email?.trim().toLowerCase();
const hasStudentConfiguration = Boolean(
  hasBaseConfiguration && studentEmail && studentPassword && hasDistinctStudentAccount
);

type Credentials = {
  email: string;
  password: string;
};

function createTextPdf(content: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let source = '%PDF-1.7\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const crossReferenceOffset = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;

  return Buffer.from(source, 'utf8');
}

async function signIn(page: Page, credentials: Credentials) {
  const initialSessionResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/get-session',
    { timeout: 30_000 }
  );
  await page.goto('/login');
  const emailField = page.getByRole('textbox', { name: 'Your email' });
  await Promise.all([initialSessionResponse, emailField.waitFor({ state: 'visible' })]);
  await emailField.fill(credentials.email);
  await page.getByRole('textbox', { name: 'Your password' }).fill(credentials.password);
  const signInResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/sign-in/email' && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Log In' }).click();
  const response = await signInResponse;
  if (!response.ok()) {
    throw new Error(`Sign-in failed: HTTP ${response.status()}`);
  }

  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 30_000 });
}

async function startImport(
  page: Page,
  file:
    | string
    | {
        name: string;
        mimeType: string;
        buffer: Buffer;
      }
) {
  const response = await page.goto(`/courses/${courseId}/lessons`);
  if (!response?.ok()) {
    throw new Error(`Course content page failed: HTTP ${response?.status() ?? 'no response'}`);
  }

  const addToSectionButton = page.locator('main button:has(svg.lucide-plus)').first();
  await expect(addToSectionButton).toBeVisible({ timeout: 60_000 });
  await addToSectionButton.click();

  const dialog = page.getByRole('dialog', { name: 'Add content' });
  await expect(dialog).toBeVisible();
  await dialog.getByText('Exercise', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByText('Import from a document', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Start import' }).click();
  await page.waitForURL(new RegExp(`/courses/${courseId}/exam-imports/[^/]+$`), { timeout: 60_000 });
}

async function expectReviewDraft(page: Page, questionCount: number, timeout: number) {
  await expect(page.getByText(`${questionCount} questions`, { exact: true })).toBeVisible({ timeout });
  await expect(page.getByRole('heading', { name: 'Questions', exact: true })).toBeVisible();
}

test.describe('exam import', () => {
  test.skip(
    !hasBaseConfiguration,
    'Set E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD, and E2E_EXAM_IMPORT_COURSE_ID to run exam import E2E.'
  );

  test.beforeEach(async ({ page }) => {
    await signIn(page, { email: email!, password: password! });
  });

  test('publishes a deterministic GIFT import', async ({ page }) => {
    test.setTimeout(120_000);

    await startImport(page, {
      name: 'exam-import-e2e.gift',
      mimeType: 'text/plain',
      buffer: Buffer.from('::Capital::What is the capital of France? {=Paris ~London ~Berlin ~Madrid}')
    });
    await expectReviewDraft(page, 1, 60_000);

    const publishButton = page.getByRole('button', { name: 'Publish exercise' }).first();
    await expect(publishButton).toBeEnabled();
    await publishButton.click();
    await page.waitForURL(new RegExp(`/courses/${courseId}/exercises/[^/]+$`), { timeout: 30_000 });
  });

  test('grades a learner submission from a published deterministic GIFT import', async ({ page, browser }) => {
    test.setTimeout(150_000);
    test.skip(
      !hasStudentConfiguration,
      'Set E2E_STUDENT_EMAIL and E2E_STUDENT_PASSWORD to a different enrolled learner account to run learner grading E2E.'
    );

    await startImport(page, {
      name: 'exam-import-e2e-learner.gift',
      mimeType: 'text/plain',
      buffer: Buffer.from('::Capital::What is the capital of France? {=Paris ~London ~Berlin ~Madrid}')
    });
    await expectReviewDraft(page, 1, 60_000);

    await page.getByRole('button', { name: 'Publish exercise' }).first().click();
    await page.waitForURL(new RegExp(`/courses/${courseId}/exercises/[^/]+$`), { timeout: 30_000 });
    const exercisePath = new URL(page.url()).pathname;

    const studentContext = await browser.newContext({ baseURL });
    const studentPage = await studentContext.newPage();
    try {
      await signIn(studentPage, { email: studentEmail!, password: studentPassword! });
      await studentPage.goto(exercisePath);
      await studentPage.getByRole('button', { name: 'Start' }).click();
      await studentPage.getByRole('button', { name: 'Start section' }).click();
      await studentPage.getByText('Paris', { exact: true }).click();
      await studentPage.getByRole('button', { name: 'Finish' }).click();
      await expect(studentPage.getByText('Graded', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(studentPage.getByText(/^1\s*\/\s*1$/).first()).toBeVisible();
    } finally {
      await studentContext.close();
    }
  });

  test('imports the provided DOCX as a review draft', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    test.skip(!hasDocxConfiguration, 'Set E2E_EXAM_IMPORT_DOCX_PATH.');

    await startImport(page, docxPath!);
    await expectReviewDraft(page, 40, 3 * 60_000);
    await expect(page.getByRole('button', { name: 'Publish exercise' }).first()).toBeDisabled();
  });

  test('keeps the provided DOCX unpublished when answer keys leave structural findings unresolved', async ({
    page
  }) => {
    test.setTimeout(4 * 60_000);
    test.skip(!hasDocxConfiguration, 'Set E2E_EXAM_IMPORT_DOCX_PATH.');

    await startImport(page, docxPath!);
    await expectReviewDraft(page, 40, 3 * 60_000);

    const compactAnswerKey = Array.from({ length: 40 }, (_, index) => `${index + 1}A`).join(' ');
    await page.getByRole('textbox', { name: 'Answer key' }).fill(compactAnswerKey);
    await page.getByRole('button', { name: 'Apply answer key' }).click();

    const publishButton = page.getByRole('button', { name: 'Publish exercise' }).first();
    await expect(page.getByText('Applied answers to 40 questions', { exact: true })).toBeVisible();
    await expect(publishButton).toBeDisabled();
  });

  test('publishes a text-layer PDF without AI', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(
      !hasTextPdfConfiguration,
      'Set E2E_EXAM_IMPORT_TEXT_PDF_ENABLED=true with API and dashboard PDF import enabled.'
    );

    const content = [
      'BT /F1 12 Tf 72 720 Td (Question 1. Which value is prime?) Tj ET',
      'BT /F1 12 Tf 72 700 Td (A. 4) Tj ET',
      'BT /F1 12 Tf 72 680 Td (B. 7) Tj ET',
      'BT /F1 12 Tf 72 660 Td (C. 8) Tj ET',
      'BT /F1 12 Tf 72 640 Td (D. 9) Tj ET',
      'BT /F1 12 Tf 72 620 Td (Answer: B) Tj ET'
    ].join('\n');
    await startImport(page, {
      name: 'exam-import-text-layer.pdf',
      mimeType: 'application/pdf',
      buffer: createTextPdf(content)
    });
    await expectReviewDraft(page, 1, 60_000);

    await page.getByRole('button', { name: 'Publish exercise' }).first().click();
    await page.waitForURL(new RegExp(`/courses/${courseId}/exercises/[^/]+$`), { timeout: 30_000 });
  });

  test('imports the provided scanned PDF as a review draft', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    test.skip(
      !hasPdfConfiguration,
      'Set E2E_EXAM_IMPORT_PDF_PATH and E2E_EXAM_IMPORT_SCANNED_PDF_ENABLED=true against a configured vision gateway.'
    );

    await startImport(page, pdfPath!);
    await expectReviewDraft(page, scannedPdfQuestionCount, 15 * 60_000);
    await expect(page.getByRole('button', { name: 'Publish exercise' }).first()).toBeDisabled();
  });
});
