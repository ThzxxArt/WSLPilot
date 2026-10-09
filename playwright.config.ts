import { defineConfig } from '@playwright/test'

/**
 * Playwright E2E（Electron）
 * 运行：npm run test:e2e
 * 说明：需要 Windows 环境；CI 中可 continue-on-error
 */
export default defineConfig({
  testDir: './apps/desktop/tests/e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    trace: 'on-first-retry',
  },
})
