import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, '../../packages/shared/src'),
        '@kit': resolve(__dirname, '../../packages/kit/src'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@ui': resolve(__dirname, '../../packages/ui/src'),
        '@shared': resolve(__dirname, '../../packages/shared/src'),
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
