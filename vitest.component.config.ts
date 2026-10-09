import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

/** 组件测试配置 — happy-dom 环境 */
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: false,
    environment: 'happy-dom',
    include: ['packages/ui/**/*.test.ts', 'apps/desktop/tests/component/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['packages/ui/src/components/**/*.{vue,ts}'],
      exclude: ['**/index.ts'],
      thresholds: {
        lines: 70,
        functions: 50,
        branches: 70,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@ui': resolve(__dirname, 'packages/ui/src'),
      '@shared': resolve(__dirname, 'packages/shared/src'),
      '@': resolve(__dirname, 'apps/desktop/src/renderer'),
    },
  },
})
