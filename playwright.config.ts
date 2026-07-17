import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 1,
  reporter: [
    ['html', { outputFolder: 'tests/e2e-report', open: 'never' }],
    ['json', { outputFile: 'tests/e2e-results.json' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
