import { expect, test, type Page } from '@playwright/test';

const environment = process['env'];
const baseURL = environment.E2E_BASE_URL;
const email = environment.E2E_EMAIL;
const password = environment.E2E_PASSWORD;
const exercisePath = environment.E2E_EXERCISE_PATH;
const hasAuthenticatedConfiguration = Boolean(baseURL && email && password);

async function signIn(page: Page) {
  const initialSessionRequest = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return responseUrl.pathname === '/api/auth/get-session';
  });

  await page.goto('/login');
  await initialSessionRequest;

  const emailField = page.getByRole('textbox', { name: 'Your email' });
  await emailField.fill(email!);
  await page.getByRole('textbox', { name: 'Your password' }).fill(password!);
  await expect(emailField).toHaveValue(email!);

  const dashboardNavigation = page.waitForURL((url) => url.pathname !== '/login');
  await page.getByRole('button', { name: 'Log In' }).click();
  await dashboardNavigation;

  return emailField;
}

test.describe('authenticated dashboard', () => {
  test.skip(
    !hasAuthenticatedConfiguration,
    'Set E2E_BASE_URL, E2E_EMAIL, and E2E_PASSWORD to run authenticated browser tests.'
  );

  test('preserves the authenticated session on the dashboard host', async ({ page }) => {
    const pageErrors: string[] = [];
    const serverErrors: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('response', (response) => {
      if (response.url().startsWith(baseURL!) && response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    const emailField = await signIn(page);

    await expect(emailField).toHaveCount(0);
    await expect(page.getByText('Something unexpected occured')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
  });

  test('opens the advanced composer through the native exercise editor', async ({ page }) => {
    test.setTimeout(90_000);
    test.skip(!exercisePath, 'Set E2E_EXERCISE_PATH to run the advanced composer browser test.');

    const pageErrors: string[] = [];
    const serverErrors: string[] = [];
    let assessmentMutationRequests = 0;

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/assessment-item') && ['POST', 'PUT'].includes(request.method())) {
        assessmentMutationRequests += 1;
      }
    });
    page.on('response', (response) => {
      if (response.url().startsWith(baseURL!) && response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    await signIn(page);
    await page.goto(exercisePath!);
    await page.getByRole('tab', { name: 'Questions' }).click();

    const addAdvancedQuestionButton = page.getByRole('button', { name: 'Add advanced question' });
    await expect(addAdvancedQuestionButton).toBeVisible();
    await addAdvancedQuestionButton.click();

    const questionTitleField = page.getByRole('textbox', { name: 'Question title' });
    const advancedComposer = questionTitleField.locator('xpath=ancestor::section[1]');
    const addChoiceButton = advancedComposer.getByRole('button', { name: 'Add choice' });
    const addExtendedTextButton = advancedComposer.getByRole('button', { name: 'Add extended text' });
    const saveAdvancedQuestionButton = advancedComposer.getByRole('button', { name: 'Save advanced question' });
    await expect(addChoiceButton).toBeVisible();
    await expect(advancedComposer.getByRole('button', { name: 'Add content' })).toBeVisible();
    await expect(addExtendedTextButton).toBeVisible();
    await expect(questionTitleField).toBeVisible();
    await saveAdvancedQuestionButton.click();
    await expect(questionTitleField).toBeFocused();
    await expect(questionTitleField).toHaveAttribute('aria-invalid', 'true');

    await questionTitleField.fill('Advanced question draft');
    await expect(questionTitleField).not.toHaveAttribute('aria-invalid', 'true');
    await addChoiceButton.click();

    const promptField = advancedComposer.getByRole('textbox', { name: 'Prompt', exact: true });
    const pointsField = advancedComposer.getByRole('spinbutton', { name: 'Points' });
    await pointsField.fill('');
    await saveAdvancedQuestionButton.click();
    await expect(pointsField).toBeFocused();
    await expect(pointsField).toHaveAttribute('aria-invalid', 'true');
    await expect(pointsField).toHaveAttribute('aria-describedby', /-message$/);

    await pointsField.fill('2');
    await expect(pointsField).not.toHaveAttribute('aria-invalid', 'true');
    await saveAdvancedQuestionButton.click();
    await expect(promptField).toBeFocused();
    await expect(promptField).toHaveAttribute('aria-invalid', 'true');

    await promptField.fill('Which option is correct?');
    const firstOptionField = advancedComposer.getByRole('textbox', { name: 'Option 1' });
    await saveAdvancedQuestionButton.click();
    await expect(firstOptionField).toBeFocused();
    await expect(firstOptionField).toHaveAttribute('aria-invalid', 'true');

    await firstOptionField.fill('First option');
    await advancedComposer.getByRole('textbox', { name: 'Option 2' }).fill('Second option');

    const firstCorrectOption = advancedComposer.getByRole('checkbox', {
      name: 'Toggle option as correct: Option 1'
    });
    await saveAdvancedQuestionButton.click();
    await expect(firstCorrectOption).toBeFocused();
    await firstCorrectOption.press('Space');
    await expect(firstCorrectOption).toBeChecked();

    await expect(advancedComposer.getByRole('checkbox', { name: 'Multiple answers' })).toBeVisible();
    await expect(firstCorrectOption).toBeVisible();
    await expect(advancedComposer.getByText('Which option is correct?', { exact: true })).toBeVisible();
    await expect(advancedComposer.getByText('First option', { exact: true })).toBeVisible();
    await expect(saveAdvancedQuestionButton).toBeVisible();

    await addExtendedTextButton.click();
    await saveAdvancedQuestionButton.click();
    const extendedTextPrompt = advancedComposer.locator(
      '[data-assessment-text-prompt] [contenteditable="true"][aria-label="Prompt"]'
    );
    await expect(extendedTextPrompt).toBeVisible();
    await expect(extendedTextPrompt).toBeFocused();
    await expect(extendedTextPrompt).toHaveAttribute('aria-invalid', 'true');
    await expect(extendedTextPrompt).toHaveAttribute('aria-describedby', /-prompt-error$/);

    await expect(page.getByText('Something unexpected occured')).toHaveCount(0);
    expect(assessmentMutationRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
  });
});
