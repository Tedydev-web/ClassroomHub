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
const scannedPdfEnabled = environment.E2E_EXAM_IMPORT_SCANNED_PDF_ENABLED === 'true';
const hasBaseConfiguration = Boolean(baseURL && email && password && courseId);
const hasDocxConfiguration = Boolean(hasBaseConfiguration && docxPath);
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

  test('imports the provided scanned PDF as a review draft', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    test.skip(
      !hasPdfConfiguration,
      'Set E2E_EXAM_IMPORT_PDF_PATH and E2E_EXAM_IMPORT_SCANNED_PDF_ENABLED=true against a configured vision gateway.'
    );

    await startImport(page, pdfPath!);
    await expectReviewDraft(page, 40, 15 * 60_000);
    await expect(page.getByRole('button', { name: 'Publish exercise' }).first()).toBeDisabled();
  });
});
