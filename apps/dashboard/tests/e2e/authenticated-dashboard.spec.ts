import { expect, test } from '@playwright/test';

const environment = process['env'];
const baseURL = environment.E2E_BASE_URL;
const email = environment.E2E_EMAIL;
const password = environment.E2E_PASSWORD;
const hasAuthenticatedConfiguration = Boolean(baseURL && email && password);

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

    const initialSessionRequest = page.waitForResponse((response) => {
      const responseUrl = new URL(response.url());

      return responseUrl.pathname === '/api/auth/get-session';
    });

    await page.goto('/login');
    await initialSessionRequest;

    const emailField = page.getByRole('textbox', { name: 'Your email' });
    const passwordField = page.getByRole('textbox', { name: 'Your password' });

    await emailField.fill(email!);
    await passwordField.fill(password!);
    await expect(emailField).toHaveValue(email!);

    const dashboardNavigation = page.waitForURL((url) => url.pathname !== '/login');
    await page.getByRole('button', { name: 'Log In' }).click();
    await dashboardNavigation;

    await expect(emailField).toHaveCount(0);
    await expect(page.getByText('Something unexpected occured')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
  });
});
