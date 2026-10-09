import { defineConfig } from '@playwright/test'

/**
 * Playwright E2E（Electron）
 * 运行：npm run test:e2e
 * 需先 build：npm run build --workspace @wslpilot/desktop
 */
export default defineConfig({
  testDir: './apps/desktop/tests/e2e',
  testMatch: '**/*.e2e.ts',
  outputDir: './test-results',
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
})
