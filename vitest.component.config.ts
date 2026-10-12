import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

/** 组件测试配置 — happy-dom 环境 */
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: false,
    environment: 'happy-dom',
    include: ['packages/ui/src/**/*.test.ts', 'apps/desktop/tests/component/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 含文件型 reporter：否则 reportsDirectory 形同虚设（只打控制台），
      // coverage-component 不产出，两套报告互覆无法核验。
      // 只用 json-summary 不用 html/lcov：后者的报告 CSS 会落进 coverage-component/，
      // 而 stylelint ignoreFiles 只豁免 **/coverage/**，会把生成物误报成 lint 错误
      reporter: ['text', 'text-summary', 'json-summary'],
      // 与单元覆盖分开放置，避免两套 --coverage 互相覆盖报告
      reportsDirectory: './coverage-component',
      // 分母真话（review 覆盖率分母瘦身根治）：此前只含 packages/ui 组件，
      // renderer 全部 .vue（约 6800 行 UI 逻辑）不进任何分母，70% 门禁不含 UI 层。
      // 现纳入 renderer .vue + router 路由表（后者无其他分母，其 afterEach 标题
      // 逻辑可被组件环境真实执行）。
      // renderer 的 .ts（stores/composables/features）不进本分母：它们已由
      // vitest.config.ts 单测门禁（≥85%）真实覆盖，重复计入会双重计数且本门禁
      // 并不「真实测」它们 —— 原则：每个源文件恰好在一个门禁分母里。
      // main.ts 是 createApp 装配入口（同 apps/desktop/src/main/index.ts 的既有
      // 豁免理由），无法在不启动整个应用的情况下真实测试。
      include: [
        'packages/ui/src/components/**/*.{vue,ts}',
        // review 0.1.2：composables/directives/naive/index.ts 此前不在任何分母——
        // vRipple/useReducedMotion/applyAccentToDom/theme-overrides 有测试但不计分，
        // 门禁对它们的回归盲区；现纳入组件分母（happy-dom 正是其真实运行环境）
        'packages/ui/src/composables/**/*.ts',
        'packages/ui/src/directives/**/*.ts',
        'packages/ui/src/naive/**/*.ts',
        'packages/ui/src/index.ts',
        'apps/desktop/src/renderer/**/*.vue',
        'apps/desktop/src/renderer/router/**/*.ts',
      ],
      // index.ts 仅豁免组件桶文件（router/index.ts 有真实逻辑，须留在分母内）
      exclude: [
        'packages/ui/src/components/index.ts',
        '**/*.test.ts',
        '**/*.d.ts',
        'apps/desktop/src/renderer/main.ts',
      ],
      // ★ 硬门禁：低于阈值 CI 直接失败。
      // per-glob 两档（review 禁止虚高摆拍）——每档 = 实测值 −2pp 向下取整的诚实地板（防回归即可）。
      // 实测（2026-10，0.1.2：ui 桶纳入 composables/directives/naive/index.ts 后重测）：
      // ui 98.95/89.71/92.86（lines/branches/functions）；renderer 89.96/84.11/59.74。
      // UI 测试持续补齐、地板随之抬升 —— 见 docs/testing.md。
      thresholds: {
        'packages/ui/src/**': {
          lines: 96,
          statements: 96,
          branches: 87,
          functions: 90,
        },
        'apps/desktop/src/renderer/**': {
          lines: 87,
          statements: 87,
          branches: 82,
          functions: 57,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@ui': resolve(__dirname, 'packages/ui/src'),
      '@': resolve(__dirname, 'apps/desktop/src/renderer'),
    },
  },
})
