/* eslint-env node */
module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended',
  ],
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    // 主源码保持 warn；测试 mock 允许 any（见 overrides）
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off', // 日志与脚本需要 console；生产写入走 logger 文件
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/tests/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      files: ['scripts/**'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      // zod 递归清洗 / 深合并必须穿透 schema 形状
      files: [
        'packages/shared/src/schema-sanitize.ts',
        'apps/desktop/src/main/services/config-service.ts',
      ],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
  ignorePatterns: [
    'dist',
    'out',
    'release',
    'node_modules',
    'coverage',
    'playwright-report',
    'test-results',
    '*.generated.*',
  ],
}
