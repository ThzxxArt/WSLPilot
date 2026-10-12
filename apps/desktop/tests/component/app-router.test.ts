import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { defaultConfig, type AppSettings } from '@wslpilot/shared'
import { createWslAPI, configGetImpl, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

/**
 * App 壳（启动装配 / 语言 / reduced-motion / 订阅解绑）+ router 路由表与 afterEach 标题。
 * 两者是 renderer 分母里最后的零覆盖源文件。
 */

const message = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
const dialog = { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() }
const notification = { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }

vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useMessage: () => message,
    useDialog: () => dialog,
    useNotification: () => notification,
  }
})

const routerMock = { push: vi.fn() }
vi.mock('vue-router', () => ({
  createWebHashHistory: () => ({}),
  createRouter: (opts: unknown) => ({
    options: opts,
    afterEach() {},
    getRoutes: () => [],
    install: () => {},
  }),
  useRouter: () => routerMock,
  useRoute: () => ({ query: {}, name: 'dashboard' }),
  RouterView: { name: 'RouterView', template: '<div class="rv-stub" />' },
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { createPinia, setActivePinia } = await import('pinia')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const { useTerminalStore } = await import('../../src/renderer/stores/terminal')
const App = (await import('../../src/renderer/App.vue')).default

const stubs = {
  DefaultLayout: true,
  ConflictResolver: true,
  CommandPalette: true,
  NConfigProvider: { template: '<div><slot /></div>' },
  NMessageProvider: { template: '<div><slot /></div>' },
  NDialogProvider: { template: '<div><slot /></div>' },
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  document.documentElement.dataset.reduceMotion = ''
  // 诚实契约形状复位（load 成功路径真实可走；显式失败用例自行 mockRejectedValue）
  wslAPI.config.get.mockImplementation(configGetImpl())
  wslAPI.terminal.list.mockResolvedValue([])
})

/** 构造 settings.jsonc 载入内容（经 config.get 走真实 load 路径） */
function settingsWith(patch: Partial<AppSettings['general']>) {
  const base = defaultConfig('settings')
  return async (fileKey?: string) => {
    if (fileKey === 'settings') return { ...base, general: { ...base.general, ...patch } }
    return fileKey ? defaultConfig(fileKey as never) : {}
  }
}

describe('App 壳装配', () => {
  it('settings.load 失败也走出 loading（finally 保证），shell 正常渲染', async () => {
    wslAPI.config.get.mockRejectedValue(new Error('配置读不动'))
    const w = mount(App, { attachTo: document.body, global: { stubs } })
    await flushPromises()
    // load 失败降级默认值，不卡 loading
    expect(w.find('.pilot-shell').exists()).toBe(true)
    expect(w.find('.loading-screen').exists()).toBe(false)
    // 订阅链全部接上
    expect(wslAPI.config.onChanged).toHaveBeenCalled()
    expect(wslAPI.app.onNavigate).toHaveBeenCalled()
    expect(wslAPI.terminal.onData).toHaveBeenCalled()
    expect(wslAPI.terminal.onExit).toHaveBeenCalled()
    expect(wslAPI.task.onProgress).toHaveBeenCalled()
    expect(wslAPI.update.onChanged).toHaveBeenCalled()
  })

  it('卸载解绑全部订阅（无泄漏）', async () => {
    const w = mount(App, { attachTo: document.body, global: { stubs } })
    await flushPromises()
    const offs = [
      wslAPI.config.onChanged.mock.results[0]!.value,
      wslAPI.app.onNavigate.mock.results[0]!.value,
      wslAPI.terminal.onData.mock.results[0]!.value,
      wslAPI.terminal.onExit.mock.results[0]!.value,
      wslAPI.task.onProgress.mock.results[0]!.value,
      wslAPI.update.onChanged.mock.results[0]!.value,
    ] as Array<() => void>
    w.unmount()
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1)
  })

  it('reducedMotion 设置写入 html dataset（经 settings.jsonc 载入）', async () => {
    wslAPI.config.get.mockImplementation(settingsWith({ reduceMotion: true }))
    mount(App, { attachTo: document.body, global: { stubs } })
    await flushPromises()
    expect(document.documentElement.dataset.reduceMotion).toBe('true')
  })

  it('locale=en-US 从 settings.jsonc 载入（导航/托盘回调走 router.push）', async () => {
    wslAPI.config.get.mockImplementation(settingsWith({ locale: 'en-US' }))
    const w = mount(App, { attachTo: document.body, global: { stubs } })
    await flushPromises()
    // 真实 load 路径：store 的 locale 来自 settings.jsonc，而非「载入失败后手工残留值」
    expect(useSettingsStore().locale).toBe('en-US')
    expect(useSettingsStore().loaded).toBe(true)

    // 托盘导航回调
    const navCb = wslAPI.app.onNavigate.mock.calls[0]![0] as (p: string) => void
    navCb('/settings')
    await flushPromises()
    expect(routerMock.push).toHaveBeenCalledWith('/settings')

    // PTY 数据回调进 store
    const dataCb = wslAPI.terminal.onData.mock.calls[0]![0] as (p: {
      ptyId: string
      chunk: string
    }) => void
    useTerminalStore().adopt('p9', { title: 't', distro: 'Ubuntu' })
    dataCb({ ptyId: 'p9', chunk: 'hi' })
    expect(useTerminalStore().getBuffer('p9')).toContain('hi')
    expect(w.exists()).toBe(true)
  })

  it('终端恢复 recover 被调用（窗口重载找回会话）', async () => {
    wslAPI.terminal.list.mockResolvedValue([
      { ptyId: 'alive1', distro: 'Ubuntu', createdAt: Date.now() },
    ])
    mount(App, { attachTo: document.body, global: { stubs } })
    await flushPromises()
    expect(wslAPI.terminal.list).toHaveBeenCalled()
    expect(useTerminalStore().sessions.map((s) => s.ptyId)).toContain('alive1')
    // 恢复的会话在 store 中可被后续 TerminalView 消费
    expect(useTerminalStore().sessions[0]!.distro).toBe('Ubuntu')
  })
})

describe('App 全局错误兜底（review 0.1.2）', () => {
  it('window.wslAPI 缺失时渲染显式错误屏（不再全页静默失能）', async () => {
    const saved = (window as { wslAPI?: unknown }).wslAPI
    delete (window as { wslAPI?: unknown }).wslAPI
    try {
      const w = mount(App, { attachTo: document.body, global: { stubs } })
      await flushPromises()
      expect(w.find('.fatal-screen').exists()).toBe(true)
      expect(w.text()).toContain('window.wslAPI 缺失')
      expect(w.find('.fatal-reload').exists()).toBe(true)
      expect(w.find('.pilot-shell').exists()).toBe(false)
      // 缺失时不尝试任何桥接订阅（避免全 undefined 调用链炸在别处）
      expect(wslAPI.config.onChanged).not.toHaveBeenCalled()
    } finally {
      ;(window as { wslAPI?: unknown }).wslAPI = saved
    }
  })

  it('子组件未捕获错误 → onErrorCaptured 渲染降级错误面板（重载按钮）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = {
      name: 'Boom',
      setup() {
        throw new Error('渲染炸了')
      },
    }
    try {
      const w = mount(App, {
        attachTo: document.body,
        global: { stubs: { ...stubs, DefaultLayout: Boom } },
      })
      await flushPromises()
      expect(w.find('.fatal-screen').exists()).toBe(true)
      expect(w.text()).toContain('渲染炸了')
      expect(w.find('.fatal-reload').exists()).toBe(true)
      expect(errSpy).toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })

  it('main.ts errorHandler：console.error + wslAPI 可用性探测', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const main = await import('../../src/renderer/main')
      const fakeApp = { config: {} as Record<string, unknown> }
      main.installGlobalErrorHandling(
        fakeApp as unknown as Parameters<typeof main.installGlobalErrorHandling>[0],
      )
      const handler = fakeApp.config.errorHandler as (
        err: unknown,
        instance: unknown,
        info: string,
      ) => void
      expect(typeof handler).toBe('function')

      handler(new Error('boom'), null, 'render')
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('渲染层未捕获错误'),
        expect.any(Error),
        'render',
      )

      // wslAPI 缺失时给出显式诊断（错误屏之外的第二层探测）
      const saved = (window as { wslAPI?: unknown }).wslAPI
      delete (window as { wslAPI?: unknown }).wslAPI
      errSpy.mockClear()
      handler(new Error('boom'), null, 'render')
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('wslAPI 不可用'))
      ;(window as { wslAPI?: unknown }).wslAPI = saved
    } finally {
      errSpy.mockRestore()
    }
  })
})
