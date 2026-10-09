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
      include: [
        'packages/shared/src/**/*.ts',
        'packages/kit/src/**/*.ts',
        'apps/desktop/src/main/**/*.ts',
        'apps/desktop/src/renderer/stores/**/*.ts',
        'apps/desktop/src/renderer/composables/**/*.ts',
        'apps/desktop/src/renderer/features/terminal/**/*.ts',
        'apps/desktop/src/renderer/features/backup/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/index.ts',
        '**/types.ts',
        'packages/shared/src/config-migrations.ts',
        'apps/desktop/src/main/updater/**',
        'apps/desktop/src/main/elevation/**',
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
