import { defineConfig, devices } from '@playwright/test';

const environment = process['env'];
const chromiumExecutablePath = environment.E2E_CHROMIUM_EXECUTABLE_PATH;
const hostResolverRules = environment.E2E_CHROMIUM_HOST_RESOLVER_RULES;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  forbidOnly: Boolean(environment.CI),
  retries: environment.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: environment.E2E_BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
          args: hostResolverRules ? [`--host-resolver-rules=${hostResolverRules}`] : []
        }
      }
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
          args: hostResolverRules ? [`--host-resolver-rules=${hostResolverRules}`] : []
        }
      }
    }
  ]
});
