import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/desktop/tests/unit/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@wslpilot/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@wslpilot/kit': resolve(__dirname, 'packages/kit/src/index.ts'),
    },
  },
})
