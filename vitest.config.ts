import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/desktop/tests/unit/**/*.test.ts'],
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
        'apps/desktop/src/renderer/features/terminal/**/*.ts',
        'apps/desktop/src/renderer/features/backup/**/*.ts',
        'apps/desktop/src/renderer/features/command/**/*.ts',
        'apps/desktop/src/renderer/features/network/**/*.ts',
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
      },
    },
  },
  resolve: {
    alias: {
      '@wslpilot/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@wslpilot/kit': resolve(__dirname, 'packages/kit/src/index.ts'),
      '@ui': resolve(__dirname, 'packages/ui/src'),
      '@shared': resolve(__dirname, 'packages/shared/src'),
    },
  },
})
