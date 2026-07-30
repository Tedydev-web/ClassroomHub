import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const environment = process['env'];
const baseURL = environment.E2E_BASE_URL;
const email = environment.E2E_EMAIL;
const password = environment.E2E_PASSWORD;
const exercisePath = environment.E2E_EXERCISE_PATH;
const lifecycleApiURL = environment.E2E_API_URL;
const lifecycleProxyURL = environment.E2E_PROXY_URL ?? baseURL;
const lifecycleCourseId = environment.E2E_COURSE_ID;
const studentEmail = environment.E2E_STUDENT_EMAIL;
const studentPassword = environment.E2E_STUDENT_PASSWORD;
const hasAuthenticatedConfiguration = Boolean(baseURL && email && password);
const hasLifecycleConfiguration = Boolean(lifecycleProxyURL && lifecycleCourseId && studentEmail && studentPassword);
const monitoredOrigins = new Set(
  [baseURL, lifecycleApiURL].flatMap((configuredURL) => (configuredURL ? [new URL(configuredURL).origin] : []))
);

interface Credentials {
  email: string;
  password: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMonitoredServerError(responseURL: URL, status: number): boolean {
  return monitoredOrigins.has(responseURL.origin) && status >= 500;
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectExplicitPassageLayout(page: Page) {
  const layouts = page.locator('[data-assessment-layout="passage-workspace"], [data-assessment-layout="split"]');
  let workspace = layouts.first();

  for (const candidate of await layouts.all()) {
    if (await candidate.isVisible()) {
      workspace = candidate;
      break;
    }
  }

  await expect(workspace).toBeVisible();
  const layout = await workspace.getAttribute('data-assessment-layout');
  const passagePanel =
    layout === 'passage-workspace'
      ? workspace.locator('[data-assessment-passage-group]').first()
      : workspace.locator('[data-assessment-panel="passage"]');
  const interactionPanel =
    layout === 'passage-workspace'
      ? workspace.locator('[data-assessment-question-group]').first()
      : workspace.locator('[data-assessment-panel="interactions"]');
  const viewport = page.viewportSize();

  if (layout === 'passage-workspace' && viewport && viewport.width < 1024) {
    const passageToggle = workspace.locator('[data-assessment-mobile-panel="passage"]');
    const questionsToggle = workspace.locator('[data-assessment-mobile-panel="questions"]');
    await passageToggle.click();
    await expect(passagePanel).toBeVisible();
    await expect(interactionPanel).toBeHidden();
    await questionsToggle.click();
    await expect(interactionPanel).toBeVisible();
    await expect(passagePanel).toBeHidden();
    return;
  }

  const passageBox = await passagePanel.boundingBox();
  const interactionBox = await interactionPanel.boundingBox();
  expect(passageBox).not.toBeNull();
  expect(interactionBox).not.toBeNull();
  if (!passageBox || !interactionBox || !viewport) return;

  if (viewport.width >= 1024) {
    expect(interactionBox.x).toBeGreaterThan(passageBox.x);
  } else {
    expect(interactionBox.y).toBeGreaterThanOrEqual(passageBox.y + passageBox.height);
  }
}

async function signIn(page: Page, credentials: Credentials) {
  const initialSessionResponse = page.waitForResponse(
    (response) => {
      const responseUrl = new URL(response.url());

      return responseUrl.pathname === '/api/auth/get-session';
    },
    { timeout: 30_000 }
  );

  const loginResponse = await page.goto('/login');
  if (!loginResponse?.ok()) {
    throw new Error(`Login page failed: HTTP ${loginResponse?.status() ?? 'no response'}`);
  }

  const emailField = page.getByRole('textbox', { name: 'Your email' });
  await Promise.all([initialSessionResponse, emailField.waitFor({ state: 'visible' })]);
  await emailField.fill(credentials.email);
  await page.getByRole('textbox', { name: 'Your password' }).fill(credentials.password);
  await expect(emailField).toHaveValue(credentials.email);

  const signInResponsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());

    return responseUrl.pathname === '/api/auth/sign-in/email' && response.request().method() === 'POST';
  });
  await page.getByRole('button', { name: 'Log In' }).click();
  const signInResponse = await signInResponsePromise;
  if (!signInResponse.ok()) {
    throw new Error(`Sign-in failed: HTTP ${signInResponse.status()}`);
  }

  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 30_000 });

  return emailField;
}

async function gotoExpectedPage(page: Page, path: string) {
  const response = await page.goto(path);
  if (!response?.ok()) {
    throw new Error(`Page navigation failed for ${path}: HTTP ${response?.status() ?? 'no response'}`);
  }
}

async function requestThroughDashboardProxy(page: Page, url: string, method: string, data?: unknown) {
  return page.evaluate(
    async ({ requestUrl, requestMethod, requestData }) => {
      const response = await fetch(requestUrl, {
        method: requestMethod,
        headers: requestData === undefined ? undefined : { 'content-type': 'application/json' },
        body: requestData === undefined ? undefined : JSON.stringify(requestData)
      });
      const payload: unknown = await response.json();

      return { status: response.status, payload };
    },
    { requestUrl: url, requestMethod: method, requestData: data }
  );
}

async function createLifecycleExercise(
  page: Page,
  proxyURL: string,
  courseId: string,
  title: string,
  legacyPrompt: string,
  legacyCorrectOption: string
) {
  const data = {
    courseId,
    title,
    description: 'Isolated browser lifecycle fixture',
    order: 0,
    questions: [
      {
        question: legacyPrompt,
        questionTypeId: 1,
        points: 1,
        order: 0,
        options: [
          { label: legacyCorrectOption, isCorrect: true },
          { label: 'Legacy incorrect option', isCorrect: false }
        ]
      }
    ]
  };
  const response = await requestThroughDashboardProxy(
    page,
    new URL(`/proxy/course/${courseId}/exercise`, proxyURL).toString(),
    'POST',
    data
  );
  if (response.status !== 201) {
    throw new Error(`Failed to create lifecycle exercise fixture: HTTP ${response.status}`);
  }

  const payload = response.payload;
  if (!isRecord(payload) || !isRecord(payload.data) || typeof payload.data.id !== 'string') {
    throw new Error('Lifecycle exercise fixture response did not contain an exercise id');
  }

  return payload.data.id;
}

async function deleteLifecycleExercise(page: Page, proxyURL: string, courseId: string, exerciseId: string) {
  const submissionsResponse = await requestThroughDashboardProxy(
    page,
    new URL(`/proxy/course/${courseId}/exercise/${exerciseId}/submissions`, proxyURL).toString(),
    'GET'
  );
  if (submissionsResponse.status < 200 || submissionsResponse.status >= 300) {
    throw new Error(`Failed to list lifecycle fixture submissions: HTTP ${submissionsResponse.status}`);
  }

  const submissionsPayload = submissionsResponse.payload;
  if (
    !isRecord(submissionsPayload) ||
    !isRecord(submissionsPayload.data) ||
    !Array.isArray(submissionsPayload.data.allSubmissions)
  ) {
    throw new Error('Lifecycle fixture submissions response did not contain allSubmissions');
  }

  for (const submission of submissionsPayload.data.allSubmissions) {
    if (!isRecord(submission) || typeof submission.id !== 'string') {
      throw new Error('Lifecycle fixture submissions response contained an invalid submission');
    }

    const deleteSubmissionResponse = await requestThroughDashboardProxy(
      page,
      new URL(`/proxy/course/${courseId}/submission/${submission.id}`, proxyURL).toString(),
      'DELETE'
    );
    if (deleteSubmissionResponse.status < 200 || deleteSubmissionResponse.status >= 300) {
      throw new Error(`Failed to delete lifecycle fixture submission: HTTP ${deleteSubmissionResponse.status}`);
    }
  }

  const response = await requestThroughDashboardProxy(
    page,
    new URL(`/proxy/course/${courseId}/exercise/${exerciseId}`, proxyURL).toString(),
    'DELETE'
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to delete lifecycle exercise fixture: HTTP ${response.status}`);
  }
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
      const responseURL = new URL(response.url());
      if (isMonitoredServerError(responseURL, response.status())) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    const emailField = await signIn(page, { email: email!, password: password! });

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
    let atomicExerciseMutationRequests = 0;

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/assessment-item') && ['POST', 'PUT'].includes(request.method())) {
        assessmentMutationRequests += 1;
      }
      if (requestUrl.pathname.includes('/exercise/') && request.method() === 'PUT') {
        atomicExerciseMutationRequests += 1;
      }
    });
    page.on('response', (response) => {
      const responseURL = new URL(response.url());
      if (isMonitoredServerError(responseURL, response.status())) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    await signIn(page, { email: email!, password: password! });
    await page.goto(exercisePath!);
    await page.getByRole('tab', { name: 'Questions' }).click();

    const addAdvancedQuestionButton = page.getByRole('button', { name: 'Add advanced question' });
    await expect(addAdvancedQuestionButton).toBeVisible();
    await addAdvancedQuestionButton.click();

    const saveAdvancedQuestionButton = page.getByRole('button', { name: 'Save advanced question' });
    const advancedComposer = saveAdvancedQuestionButton.locator('xpath=ancestor::section[1]');
    const questionTitleField = advancedComposer.getByRole('group', { name: 'Question title' });
    const questionTitleEditor = questionTitleField.locator('[contenteditable="true"]');
    const addChoiceButton = advancedComposer.getByRole('button', { name: 'Choice question' });
    const addExtendedTextButton = advancedComposer.getByRole('button', { name: 'Extended text' });
    await expect(addChoiceButton).toBeVisible();
    await expect(advancedComposer.getByRole('button', { name: 'Add content' })).toBeVisible();
    await expect(addExtendedTextButton).toBeVisible();
    await expect(questionTitleField).toBeVisible();
    await saveAdvancedQuestionButton.click();
    await expect(questionTitleField).toBeFocused();
    await expect(questionTitleField).toHaveAttribute('aria-invalid', 'true');

    await questionTitleEditor.fill('Advanced question draft');
    await expect(questionTitleField).not.toHaveAttribute('aria-invalid', 'true');
    await addChoiceButton.click();

    const promptField = advancedComposer.getByRole('group', { name: 'Prompt', exact: true }).first();
    const promptEditor = promptField.locator('[contenteditable="true"]');
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

    await promptEditor.fill('Which option is correct?');
    const firstOptionField = advancedComposer.getByRole('group', { name: 'Option 1' });
    const firstOptionEditor = firstOptionField.locator('[contenteditable="true"]');
    await saveAdvancedQuestionButton.click();
    await expect(firstOptionField).toBeFocused();
    await expect(firstOptionField).toHaveAttribute('aria-invalid', 'true');

    await firstOptionEditor.fill('First option');
    await advancedComposer
      .getByRole('group', { name: 'Option 2' })
      .locator('[contenteditable="true"]')
      .fill('Second option');

    const firstCorrectOption = advancedComposer.getByRole('checkbox', {
      name: 'Toggle option as correct: Option 1'
    });
    await saveAdvancedQuestionButton.click();
    await expect(firstCorrectOption).toBeFocused();
    await firstCorrectOption.press('Space');
    await expect(firstCorrectOption).toBeChecked();

    await expect(advancedComposer.getByRole('checkbox', { name: 'Multiple answers' })).toBeVisible();
    await expect(firstCorrectOption).toBeVisible();
    await expect(promptEditor).toHaveText('Which option is correct?');
    await expect(firstOptionEditor).toHaveText('First option');
    await expect(advancedComposer.locator('[data-assessment-layout="stacked"]')).toBeVisible();
    await expect(advancedComposer.locator('[data-assessment-layout="split"]')).toHaveCount(0);
    await expect(saveAdvancedQuestionButton).toBeVisible();

    await pointsField.fill('0');
    await saveAdvancedQuestionButton.click();
    await expect(page.getByText('Set a positive point value for every question before saving.')).toBeVisible();
    expect(atomicExerciseMutationRequests).toBe(0);
    await pointsField.fill('2');

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

  test('preserves the attempted canonical revision across authoring, submission, editing, and review', async ({
    page,
    browser
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(
      !hasLifecycleConfiguration,
      'Set E2E_API_URL, E2E_COURSE_ID, E2E_STUDENT_EMAIL, and E2E_STUDENT_PASSWORD to run the lifecycle test.'
    );

    const fixtureTitle = `Assessment lifecycle ${testInfo.project.name} ${randomUUID()}`;
    const attemptedChoicePrompt = 'Which lifecycle option is correct?';
    const currentChoicePrompt = 'Which option belongs to the current revision?';
    const textPrompt = 'Explain the lifecycle answer';
    const legacyPrompt = 'Which legacy option is correct?';
    const legacyCorrectOption = 'Legacy correct option';
    const learnerTextResponse = 'The first option matches the authored answer key.';
    const pageErrors: string[] = [];
    const serverErrors: string[] = [];
    let standaloneAssessmentMutationRequests = 0;
    let lifecycleExerciseId: string | undefined;
    let studentContext: BrowserContext | undefined;

    page.on('pageerror', (error) => {
      pageErrors.push(`teacher: ${error.message}`);
    });
    page.on('request', (request) => {
      const requestURL = new URL(request.url());
      if (requestURL.pathname.endsWith('/assessment-item') && ['POST', 'PUT'].includes(request.method())) {
        standaloneAssessmentMutationRequests += 1;
      }
    });
    page.on('response', (response) => {
      const responseURL = new URL(response.url());
      if (isMonitoredServerError(responseURL, response.status())) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    try {
      await signIn(page, { email: email!, password: password! });
      lifecycleExerciseId = await createLifecycleExercise(
        page,
        lifecycleProxyURL!,
        lifecycleCourseId!,
        fixtureTitle,
        legacyPrompt,
        legacyCorrectOption
      );
      const exerciseURL = `/courses/${lifecycleCourseId}/exercises/${lifecycleExerciseId}`;

      await gotoExpectedPage(page, exerciseURL);
      await page.getByRole('tab', { name: 'Questions' }).click();
      await page.getByRole('button', { name: 'Add advanced question' }).click();

      const saveAdvancedQuestionButton = page.getByRole('button', { name: 'Save advanced question' }).last();
      let advancedComposer = saveAdvancedQuestionButton.locator('xpath=ancestor::section[1]');
      const questionTitleField = advancedComposer.getByRole('group', { name: 'Question title' });
      const questionTitleEditor = questionTitleField.locator('[contenteditable="true"]');
      await questionTitleEditor.fill(fixtureTitle);
      const composerTitleFieldId = await questionTitleField.getAttribute('id');
      if (!composerTitleFieldId) {
        throw new Error('Assessment composer title field did not expose an id');
      }

      advancedComposer = page.locator(`#${composerTitleFieldId}`).locator('xpath=ancestor::section[1]');
      const questionLayoutSelect = advancedComposer.getByRole('button', { name: 'Question layout' });
      await expect(questionLayoutSelect).toContainText('Standard flow');
      await questionLayoutSelect.click();
      await page.getByRole('option', { name: 'Passage and question panel' }).click();
      await expect(questionLayoutSelect).toContainText('Passage and question panel');
      await advancedComposer
        .getByRole('textbox', { name: 'Add context, instructions, or media' })
        .fill('Read the prompt and answer both interactions.');
      const choicePrompt = advancedComposer
        .getByRole('group', { name: 'Prompt', exact: true })
        .first()
        .locator('[contenteditable="true"]');
      await choicePrompt.fill(attemptedChoicePrompt);
      await advancedComposer.getByRole('spinbutton', { name: 'Points' }).fill('2');
      await advancedComposer
        .getByRole('group', { name: 'Option 1' })
        .locator('[contenteditable="true"]')
        .fill('Correct option');
      await advancedComposer
        .getByRole('group', { name: 'Option 2' })
        .locator('[contenteditable="true"]')
        .fill('Incorrect option');
      await advancedComposer.getByRole('checkbox', { name: 'Toggle option as correct: Option 1' }).check();
      await advancedComposer.getByRole('button', { name: 'Extended text' }).click();

      const extendedTextPrompt = advancedComposer.locator(
        '[data-assessment-text-prompt] [contenteditable="true"][aria-label="Prompt"]'
      );
      await extendedTextPrompt.fill(textPrompt);

      await advancedComposer.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(page.getByRole('group', { name: attemptedChoicePrompt, exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: textPrompt })).toBeVisible();
      await expectExplicitPassageLayout(page);
      await expectNoHorizontalPageOverflow(page);
      await advancedComposer.getByRole('button', { name: 'Back to editor', exact: true }).last().click();
      await expect(extendedTextPrompt).toHaveText(textPrompt);

      const createAssessmentResponse = page.waitForResponse((response) => {
        const responseURL = new URL(response.url());

        return (
          responseURL.pathname.endsWith(`/course/${lifecycleCourseId}/exercise/${lifecycleExerciseId}`) &&
          response.request().method() === 'PUT'
        );
      });
      await advancedComposer.getByRole('button', { name: 'Save advanced question', exact: true }).click();
      expect((await createAssessmentResponse).status()).toBe(200);

      const { deviceScaleFactor, hasTouch, isMobile, userAgent, viewport } = testInfo.project.use;
      studentContext = await browser.newContext({
        baseURL,
        deviceScaleFactor,
        hasTouch,
        isMobile,
        userAgent,
        viewport
      });
      const studentPage = await studentContext.newPage();
      expect(studentPage.viewportSize()).toEqual(viewport);
      studentPage.on('pageerror', (error) => {
        pageErrors.push(`student: ${error.message}`);
      });
      studentPage.on('response', (response) => {
        const responseURL = new URL(response.url());
        if (isMonitoredServerError(responseURL, response.status())) {
          serverErrors.push(`${response.status()} ${response.url()}`);
        }
      });

      await signIn(studentPage, { email: studentEmail!, password: studentPassword! });
      const studentExerciseResponse = await requestThroughDashboardProxy(
        studentPage,
        new URL(`/proxy/course/${lifecycleCourseId}/exercise/${lifecycleExerciseId}`, lifecycleProxyURL!).toString(),
        'GET'
      );
      if (studentExerciseResponse.status === 403) {
        const errorPayload = studentExerciseResponse.payload;
        if (isRecord(errorPayload) && errorPayload.code === 'ORG_TEAM_NOT_AUTHORIZED') {
          throw new Error(
            `Lifecycle student fixture must already be enrolled in course ${lifecycleCourseId} before running this test`
          );
        }
      }
      if (studentExerciseResponse.status < 200 || studentExerciseResponse.status >= 300) {
        throw new Error(`Failed to fetch lifecycle exercise as student: HTTP ${studentExerciseResponse.status}`);
      }

      const studentExercisePayload = studentExerciseResponse.payload;
      if (!isRecord(studentExercisePayload) || !isRecord(studentExercisePayload.data)) {
        throw new Error('Student exercise response did not contain exercise data');
      }
      if (!Array.isArray(studentExercisePayload.data.canonicalQuestions)) {
        throw new Error('Student exercise response did not contain canonical questions');
      }
      expect(studentExercisePayload.data.canonicalQuestions).toHaveLength(1);

      const [canonicalQuestion] = studentExercisePayload.data.canonicalQuestions;
      if (
        !isRecord(canonicalQuestion) ||
        (typeof canonicalQuestion.id !== 'number' && typeof canonicalQuestion.id !== 'string')
      ) {
        throw new Error('Student exercise response did not contain a canonical question id');
      }
      expect(String(canonicalQuestion.id)).not.toBe('');

      await gotoExpectedPage(studentPage, exerciseURL);
      const startExerciseButton = studentPage.getByRole('button', { name: 'Start' });
      await expect(startExerciseButton).toBeVisible({ timeout: 30_000 });
      await startExerciseButton.click();
      await expect(studentPage.getByText(legacyPrompt, { exact: true })).toBeVisible();
      await studentPage.getByRole('radio', { name: legacyCorrectOption, exact: true }).check();
      await expect(studentPage.getByText('1/3', { exact: true })).toBeVisible();
      const nextQuestionButton = studentPage
        .getByRole('button', { name: 'Next', exact: true })
        .filter({ visible: true })
        .last();
      await expect(nextQuestionButton).toBeEnabled();
      await nextQuestionButton.click();
      await expect(studentPage.getByText(attemptedChoicePrompt, { exact: true })).toBeVisible();
      await expect(studentPage.getByText('1/3', { exact: true })).toBeVisible();
      await expectExplicitPassageLayout(studentPage);
      const correctOption = studentPage.getByRole('radio', { name: 'Correct option', exact: true });
      const learnerTextField = studentPage.getByRole('textbox', { name: textPrompt });
      const finishExerciseButton = studentPage.getByRole('button', { name: 'Finish' });

      await finishExerciseButton.click();
      await expect(correctOption).toBeFocused();
      await expect(correctOption).toHaveAttribute('aria-invalid', 'true');
      await expect(correctOption).toHaveAttribute('aria-describedby', /-error$/);

      await correctOption.press('Space');
      await expect(correctOption).toBeChecked();
      await expect(studentPage.getByText('2/3', { exact: true })).toBeVisible();
      await finishExerciseButton.click();
      await expect(learnerTextField).toBeFocused();
      await expect(learnerTextField).toHaveAttribute('aria-invalid', 'true');
      await expect(learnerTextField).toHaveAttribute('aria-describedby', /-error$/);

      await learnerTextField.fill(learnerTextResponse);
      await expect(learnerTextField).not.toHaveAttribute('aria-invalid', 'true');
      await expect(studentPage.getByText('3/3', { exact: true })).toBeVisible();
      await expectNoHorizontalPageOverflow(studentPage);

      const submissionResponse = studentPage.waitForResponse((response) => {
        const responseURL = new URL(response.url());

        return (
          responseURL.pathname.endsWith(`/exercise/${lifecycleExerciseId}/submission`) &&
          response.request().method() === 'POST'
        );
      });
      const previousQuestionButton = studentPage
        .getByRole('button', { name: 'Previous', exact: true })
        .filter({ visible: true })
        .last();
      await learnerTextField.press('Tab');
      await expect(previousQuestionButton).toBeFocused();
      await previousQuestionButton.press('Tab');
      await expect(finishExerciseButton).toBeFocused();
      await finishExerciseButton.press('Enter');
      const createdSubmissionResponse = await submissionResponse;
      expect(createdSubmissionResponse.status()).toBe(201);
      const createdSubmissionPayload: unknown = await createdSubmissionResponse.json();
      if (!isRecord(createdSubmissionPayload) || !isRecord(createdSubmissionPayload.data)) {
        throw new Error('Created submission response did not contain submission data');
      }
      if (typeof createdSubmissionPayload.data.id !== 'string') {
        throw new Error('Created submission response did not contain a submission id');
      }
      const lifecycleSubmissionId = createdSubmissionPayload.data.id;
      expect(createdSubmissionPayload.data.gradingState).toBe('awaiting_manual');
      await expect(studentPage.getByText('Submitted', { exact: true })).toBeVisible();

      await gotoExpectedPage(page, `/courses/${lifecycleCourseId}/submissions?submissionId=${lifecycleSubmissionId}`);
      const gradingDialog = page.getByRole('dialog');
      await expect(gradingDialog).toBeVisible();
      const gradeFields = gradingDialog.getByPlaceholder('Points');
      await expect(gradeFields).toHaveCount(2);
      await expect(gradeFields.first()).toHaveValue('1');
      await gradeFields.last().fill('3');
      const gradeResponsePromise = page.waitForResponse((response) => {
        const responseURL = new URL(response.url());

        return responseURL.pathname.endsWith(`/submission/${lifecycleSubmissionId}/grades`);
      });
      await gradingDialog.getByRole('button', { name: 'Submit Grades' }).click();
      const gradeResponse = await gradeResponsePromise;
      expect(gradeResponse.status()).toBe(200);
      const gradePayload: unknown = await gradeResponse.json();
      if (!isRecord(gradePayload) || !isRecord(gradePayload.data)) {
        throw new Error('Grade response did not contain submission data');
      }
      expect(gradePayload.data.gradingState).toBe('completed');
      expect(gradePayload.data.score).toBe(4);
      await expect(gradingDialog).toHaveCount(0);

      await gotoExpectedPage(page, exerciseURL);
      await page.getByRole('tab', { name: 'Questions' }).click();
      const editExerciseButton = page.getByRole('button', { name: 'Edit', exact: true });
      if (await editExerciseButton.isVisible()) {
        await editExerciseButton.click();
      }
      const currentChoicePromptField = page
        .getByRole('group', { name: 'Prompt', exact: true })
        .first()
        .locator('[contenteditable="true"]');
      await expect(currentChoicePromptField).toBeVisible({ timeout: 30_000 });
      await currentChoicePromptField.fill(currentChoicePrompt, { timeout: 30_000 });
      await page.getByRole('spinbutton', { name: 'Points' }).first().fill('4', { timeout: 30_000 });
      const publishAssessmentResponse = page.waitForResponse(
        (response) => {
          const responseURL = new URL(response.url());

          return (
            responseURL.pathname.endsWith(`/course/${lifecycleCourseId}/exercise/${lifecycleExerciseId}`) &&
            response.request().method() === 'PUT'
          );
        },
        { timeout: 30_000 }
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 30_000 });
      expect((await publishAssessmentResponse).status()).toBe(200);

      await gotoExpectedPage(page, `${exerciseURL}?tab=submissions`);
      await page.getByRole('tab', { name: 'Submissions' }).click();
      await page.getByRole('tab', { name: 'Individual' }).click();
      await expect(page.getByText("John Doe's answers", { exact: true })).toBeVisible();
      const historicalReviewItem = page
        .getByRole('heading', { name: fixtureTitle, exact: true })
        .locator('..')
        .locator('..');
      await expect(historicalReviewItem).toBeVisible();
      await expect(historicalReviewItem.getByText(attemptedChoicePrompt, { exact: true })).toBeVisible();
      await expect(historicalReviewItem.getByText(currentChoicePrompt, { exact: true })).toHaveCount(0);
      await expect(historicalReviewItem.getByRole('radio', { name: 'Correct option', exact: true })).toBeChecked();
      await expect(historicalReviewItem.getByRole('textbox', { name: textPrompt })).toHaveText(learnerTextResponse);
      await expectExplicitPassageLayout(page);
      await expect(page.getByText(/4\/4\s*points/)).toBeVisible();
      await expectNoHorizontalPageOverflow(page);

      expect(pageErrors).toEqual([]);
      expect(serverErrors).toEqual([]);
      expect(standaloneAssessmentMutationRequests).toBe(0);
    } finally {
      try {
        if (lifecycleExerciseId) {
          await deleteLifecycleExercise(page, lifecycleProxyURL!, lifecycleCourseId!, lifecycleExerciseId);
        }
      } finally {
        await studentContext?.close();
      }
    }
  });
});
