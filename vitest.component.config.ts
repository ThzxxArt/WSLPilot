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
      // 实测（2026-10，0.1.1：221 用例）：ui 98.25/90.76/83.33；renderer 87.90/82.51/54.69。
      // UI 测试持续补齐、地板随之抬升（renderer 地板已从 84/80/47 → 85/80/52）——见 docs/testing.md。
      thresholds: {
        'packages/ui/src/components/**': {
          lines: 96,
          statements: 96,
          branches: 88,
          functions: 81,
        },
        'apps/desktop/src/renderer/**': {
          lines: 85,
          statements: 85,
          branches: 80,
          functions: 52,
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
