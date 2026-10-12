import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createWslAPI, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

/**
 * 生产壳 provider 链守卫（review 假信心根治）：
 * NetworkView 真实调用 useNotification()，缺 n-notification-provider 时 setup 即抛、
 * 路由页渲染为空白——此前组件测试把 useNotification 整个 mock 掉，测试全绿而生产白屏。
 * 本文件**不 mock naive-ui**（只 mock vue-router 与 wslAPI），以真实 provider 链
 * 挂载 App 壳并让 RouterView 渲染真实 NetworkView：provider 缺失即红。
 */

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {}, name: 'network' }),
  RouterView: { name: 'RouterView', template: '<div class="rv-stub"><slot /></div>' },
}))

const wslAPI: WslAPIMock = createWslAPI()
;(globalThis as any).window.wslAPI = wslAPI

describe('生产壳 provider 链（真 naive-ui）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(globalThis as any).window.wslAPI = wslAPI
    ;(globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }
  })

  it('App 壳 + 真实 NetworkView：useNotification 三提供齐全（缺 provider 即红）', async () => {
    const NetworkView = (await import('../../src/renderer/views/NetworkView.vue')).default
    const App = (await import('../../src/renderer/App.vue')).default
    // RouterView 换成真实 NetworkView（vue-router 已 mock，RouterView 由 stub 改渲染真实视图）
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia()],
        stubs: {
          RouterView: NetworkView,
          // DefaultLayout 里还有侧栏等重依赖，只留视图槽位
          DefaultLayout: { template: '<div class="layout-stub"><RouterView /></div>' },
        },
      },
    })
    await flushPromises()
    // review 0.1.2：去掉硬 sleep 100ms（负载相关抖动源）——条件等待：轮询断言直到满足或超时
    await vi.waitFor(
      () => {
        expect(wrapper.text()).toContain('网络模式')
        expect(wrapper.text()).not.toContain('读取失败')
      },
      { timeout: 30_000, interval: 50 },
    )
    // NetworkView setup 走完（useNotification 不抛）且渲染出镜像卡标题
    expect(wrapper.text()).toContain('网络模式')
    // 健康路径断言：真实 network 契约（support.createWslAPI 已补命名空间）下不得落错误态
    expect(wslAPI.network.status).toHaveBeenCalled()
    expect(wrapper.text()).toContain('端口转发')
    expect(wrapper.text()).not.toContain('读取失败')
  }, 60_000) // 真 naive 全家桶 + 真 App/NetworkView 挂载是重量级用例（单跑 ~22s）；60s 防合跑负载下假超时
})
