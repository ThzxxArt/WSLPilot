import { createApp, type App as VueApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import '@ui/styles/index.scss'

/**
 * 全局错误兜底（review 0.1.2 根治）：
 * 此前渲染层任何未捕获异常只进控制台 —— 用户面对白屏既无感知也无出路。
 * errorHandler 负责记录并探测 wslAPI 可用性（诊断信息）；
 * 面向用户的降级面板由 App.vue onErrorCaptured 渲染（重载按钮）。
 * 导出为独立函数：测试可直接装配到伪 app 上驱动，不必启动整个渲染入口。
 */
export function installGlobalErrorHandling(app: VueApp): void {
  app.config.errorHandler = (err, _instance, info) => {
    console.error('[WSLPilot] 渲染层未捕获错误:', err, info)
    // 尝试探测主进程桥接是否可用：wslAPI 缺失是「白屏 + 全页静默失能」的根因之一
    try {
      const api = (globalThis as { window?: { wslAPI?: unknown } }).window?.wslAPI
      if (!api) console.error('[WSLPilot] window.wslAPI 不可用：主进程桥接缺失，功能不可用')
    } catch (probeErr) {
      console.error('[WSLPilot] wslAPI 可用性探测失败:', probeErr)
    }
  }
}

const app = createApp(App)
installGlobalErrorHandling(app)
app.use(createPinia())
app.use(router)

// 挂载目标由 index.html 提供；缺失时保持未挂载（模块可被测试安全导入）
const mountTarget = typeof document !== 'undefined' ? document.getElementById('app') : null
if (mountTarget) app.mount(mountTarget)
