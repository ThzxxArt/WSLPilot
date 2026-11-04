import js from '@eslint/js'
import ts from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

/** Node / 浏览器全局（不引入 globals 依赖，保持依赖面最小） */
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'readonly',
  require: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
}

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLDetailsElement: 'readonly',
  Element: 'readonly',
  Node: 'readonly',
  Event: 'readonly',
  PointerEvent: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  Blob: 'readonly',
  performance: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  CustomEvent: 'readonly',
  ResizeObserver: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  getComputedStyle: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/coverage-component/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.generated.*',
      'package-lock.json',
    ],
  },
  js.configs.recommended,
  ...ts.configs['flat/recommended'],
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,cjs,ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      // ESLint 10 新增的死赋值检查对本仓库「先赋默认值、分支内覆盖」的写法误报较多；
      // 未使用变量仍由 @typescript-eslint/no-unused-vars 约束
      'no-useless-assignment': 'off',
      // Prettier 接管格式
      'no-extra-semi': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-spacing': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-quotes': 'off',
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
      globals: { ...nodeGlobals, ...browserGlobals },
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,vue}', 'packages/ui/src/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...nodeGlobals, ...browserGlobals },
    },
  },
  {
    files: ['**/*.test.ts', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // 测试文件常定义多个本地桩组件
      'vue/one-component-per-file': 'off',
    },
  },
  {
    files: ['scripts/**', '**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: nodeGlobals },
    rules: { 'no-console': 'off' },
  },
  {
    files: [
      'packages/shared/src/schema-sanitize.ts',
      'apps/desktop/src/main/services/config-service.ts',
    ],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
]
