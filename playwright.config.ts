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
  // 应用是单实例语义（二次启动聚焦已有窗口并退出）——
  // 并行 worker 双开 Electron 会让后启动的实例秒退、断言假红（review 根治）
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  // 视觉回归基线（M7）：基线按平台分文件（{platform} 后缀）并随仓库入库；
  // 'none' = 缺基线直接红（禁止 CI 自动造基线放行 — review 假门禁根治）。
  // 新增截图用例时在目标平台跑 `npx playwright test --grep @visual --update-snapshots=all` 生成并提交。
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}',
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
