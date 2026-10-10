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
  // 视觉回归基线（M7）：首次运行生成（missing），其后比对；不因缺基线而假绿/假红
  updateSnapshots: 'missing',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      // 浅色主题渲染一致性：容差 2%（字体抗锯齿差异）
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
})
