import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// workspace TS 包必须打进 bundle：main 可 require TS 源码，
// sandbox preload 禁止 require 任意 npm 包（评审 C1/C2）
const bundleWorkspace = ['@wslpilot/shared', '@wslpilot/kit']

// main / preload / renderer 三端统一的 workspace 包别名：显式指向各包 src，
// 不依赖 workspace node_modules 隐式解析（此前 renderer/preload 隐式、main 显式，策略不一致）
const workspaceAlias = {
  '@wslpilot/shared': resolve(__dirname, '../../packages/shared/src'),
  '@wslpilot/kit': resolve(__dirname, '../../packages/kit/src'),
  '@wslpilot/ui': resolve(__dirname, '../../packages/ui/src'),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundleWorkspace })],
    resolve: {
      alias: {
        ...workspaceAlias,
      },
    },
  },
  preload: {
    // sandbox preload：全部内联，仅保留 electron 原生 external
    plugins: [externalizeDepsPlugin({ exclude: bundleWorkspace })],
    resolve: {
      alias: {
        ...workspaceAlias,
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        ...workspaceAlias,
        '@': resolve(__dirname, 'src/renderer'),
        '@ui': resolve(__dirname, '../../packages/ui/src'),
      },
    },
    plugins: [vue()],
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
  },
})
