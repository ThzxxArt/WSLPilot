import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// workspace TS 包必须打进 bundle：main 可 require TS 源码，
// sandbox preload 禁止 require 任意 npm 包（评审 C1/C2）
const bundleWorkspace = ['@wslpilot/shared', '@wslpilot/kit']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundleWorkspace })],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, '../../packages/shared/src'),
        '@kit': resolve(__dirname, '../../packages/kit/src'),
        '@wslpilot/shared': resolve(__dirname, '../../packages/shared/src'),
        '@wslpilot/kit': resolve(__dirname, '../../packages/kit/src'),
      },
    },
  },
  preload: {
    // sandbox preload：全部内联，仅保留 electron 原生 external
    plugins: [externalizeDepsPlugin({ exclude: bundleWorkspace })],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, '../../packages/shared/src'),
        '@wslpilot/shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@ui': resolve(__dirname, '../../packages/ui/src'),
        '@shared': resolve(__dirname, '../../packages/shared/src'),
        '@wslpilot/shared': resolve(__dirname, '../../packages/shared/src'),
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
