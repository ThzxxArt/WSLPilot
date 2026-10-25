import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/desktop/tests/unit/**/*.test.ts'],
    // packages/ui 的同居测试只归 vitest.component.config.ts（happy-dom）管：
    // 根配置是 node 环境，误跑 Vue 测试会假红/假绿 —— 双配置双重包含隐患根治
    exclude: [...configDefaults.exclude, 'packages/ui/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // 覆盖面必须覆盖「有真实逻辑」的代码：漏掉 = 永远不受门禁约束（review 测试假信心根治）。
      // 早期只列了 features/{terminal,backup,command}，把 preload 安全边界、
      // main 入口、features/network 全部排除在外，85% 阈值只是对「易测子集」打分。
      include: [
        'packages/shared/src/**/*.ts',
        'packages/kit/src/**/*.ts',
        'apps/desktop/src/main/**/*.ts',
        'apps/desktop/src/preload/**/*.ts',
        'apps/desktop/src/renderer/stores/**/*.ts',
        'apps/desktop/src/renderer/composables/**/*.ts',
        // review 0.1.2：features 用通配整体纳入 —— 枚举白名单会让未来新 feature 目录的
        // .ts 静默掉出分母（漏测 = 不受门禁约束），枚举维护跟不上新增目录
        'apps/desktop/src/renderer/features/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        // 纯类型文件与 re-export 桶文件（无逻辑）
        '**/types.ts',
        'packages/*/src/index.ts',
        'packages/ui/src/**',
        // Electron 装配入口：依赖 app/Menu/Tray 等原生模块，逻辑已拆到
        // window/、ipc/、services/ 各自可测模块（含 navigation-guard）
        'apps/desktop/src/main/index.ts',
      ],
      // ★ 硬门禁：低于阈值 CI 直接失败
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
        // 0.1.4：per-glob 地板（每个高风险目录单独兜底，防止用易测文件拉高总体）
        'apps/desktop/src/main/services/**': {
          lines: 92,
          statements: 92,
          branches: 85,
          functions: 90,
        },
        'apps/desktop/src/main/ipc/handlers/**': {
          lines: 88,
          statements: 88,
          branches: 78,
          functions: 95,
        },
        'apps/desktop/src/renderer/stores/**': {
          lines: 87,
          statements: 87,
          branches: 84,
          functions: 78,
        },
        'apps/desktop/src/renderer/composables/**': {
          lines: 93,
          statements: 93,
          branches: 88,
          functions: 92,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@wslpilot/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@wslpilot/kit': resolve(__dirname, 'packages/kit/src/index.ts'),
      '@ui': resolve(__dirname, 'packages/ui/src'),
    },
  },
})
