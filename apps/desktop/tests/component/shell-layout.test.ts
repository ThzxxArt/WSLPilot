import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { appError, createWslAPI, distro, bodyText, keydown, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

/**
 * 布局壳四件套（DefaultLayout / SidebarNav / StatusBar / TitleBar）：
 * 挂载渲染 + 关键交互（导航跳转、窗口控制、折叠持久化、快捷键）+ 错误态提示。
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

const routeMock = { name: 'dashboard', query: {} as Record<string, unknown>, path: '/' }
const routerMock = { push: vi.fn() }
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => routeMock,
  RouterView: { name: 'RouterView', template: '<div class="router-view-stub" />' },
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { createPinia, setActivePinia } = await import('pinia')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const { useDistrosStore } = await import('../../src/renderer/stores/distros')
const { useTasksStore } = await import('../../src/renderer/stores/tasks')
const { useCommandPalette } = await import('../../src/renderer/composables/useCommandPalette')
const DefaultLayout = (await import('../../src/renderer/layouts/DefaultLayout.vue')).default
const SidebarNav = (await import('../../src/renderer/layouts/SidebarNav.vue')).default
const StatusBar = (await import('../../src/renderer/layouts/StatusBar.vue')).default
const TitleBar = (await import('../../src/renderer/layouts/TitleBar.vue')).default

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useCommandPalette().closePalette()
  document.body.innerHTML = ''
  routeMock.name = 'dashboard'
  wslAPI.config.get.mockResolvedValue({})
  wslAPI.config.set.mockResolvedValue({})
})

describe('SidebarNav', () => {
  it('渲染七个导航项，点击「发行版」路由跳转到 distros', async () => {
    routeMock.name = 'distros'
    const w = mount(SidebarNav, { props: { collapsed: false }, attachTo: document.body })
    expect(w.findAll('.nav-item')).toHaveLength(7)
    expect(w.text()).toContain('驾驶舱')
    expect(w.text()).toContain('备份迁移')
    // 高亮跟随当前路由
    const active = w.findAll('.nav-item').find((b) => b.classes().includes('active'))
    expect(active!.text()).toContain('发行版')

    w.findAll('.nav-item')[2]!.trigger('click')
    expect(routerMock.push).toHaveBeenCalledWith({ name: 'terminal' })
  })

  it('折叠态隐藏标题文字，折叠按钮发出 update:collapsed', async () => {
    const w = mount(SidebarNav, { props: { collapsed: true }, attachTo: document.body })
    expect(w.find('.nav-title').exists()).toBe(false)
    expect(w.find('.collapse-btn').attributes('aria-label')).toBe('展开侧栏')

    await w.find('.collapse-btn').trigger('click')
    expect(w.emitted('update:collapsed')![0]).toEqual([false])
  })
})

describe('TitleBar', () => {
  it('窗口控制按钮分别调用 minimize/maximize/close', async () => {
    const w = mount(TitleBar, { attachTo: document.body })
    const btns = w.findAll('.win-btn')
    expect(btns).toHaveLength(3)
    await btns[0]!.trigger('click')
    await btns[1]!.trigger('click')
    await btns[2]!.trigger('click')
    expect(wslAPI.app.minimize).toHaveBeenCalledTimes(1)
    expect(wslAPI.app.maximize).toHaveBeenCalledTimes(1)
    expect(wslAPI.app.close).toHaveBeenCalledTimes(1)
  })

  it('搜索框点击 / 回车打开命令面板', async () => {
    const w = mount(TitleBar, { attachTo: document.body })
    const palette = useCommandPalette()
    await w.find('.search-box').trigger('click')
    expect(palette.open.value).toBe(true)

    palette.closePalette()
    await w.find('.search-box').trigger('keydown', { key: 'Enter' })
    expect(palette.open.value).toBe(true)
  })
})

describe('StatusBar', () => {
  it('运行中任务渲染进度 chip，点击展开任务抽屉', async () => {
    const tasks = useTasksStore()
    tasks.applyProgress({
      taskId: 't1',
      type: 'export',
      distro: 'Ubuntu',
      percent: 42,
      message: '导出中',
      status: 'running',
    })
    useSettingsStore().version = '9.9.9'
    mount(StatusBar, { attachTo: document.body })
    await flushPromises()

    const chip = document.body.querySelector('.task-chip')
    expect(chip).toBeTruthy()
    expect(chip!.textContent).toContain('42%')
    expect(bodyText()).toContain('WSLPilot v9.9.9')

    chip!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    // 抽屉内容 teleport 到 body
    expect(bodyText()).toContain('任务')
    expect(document.body.querySelector('.task-drawer')).toBeTruthy()
  })

  it('版本缺失时降级为「—」', () => {
    useSettingsStore().version = ''
    mount(StatusBar, { attachTo: document.body })
    expect(bodyText()).toContain('WSLPilot v—')
  })
})

describe('DefaultLayout', () => {
  it('侧栏折叠态从 uiState 读回并持久化', async () => {
    wslAPI.config.get.mockResolvedValue({ sidebarCollapsed: true })
    const w = mount(DefaultLayout, {
      attachTo: document.body,
      global: { stubs: { 'router-view': true } },
    })
    await flushPromises()
    expect(wslAPI.config.get).toHaveBeenCalledWith('uiState')
    expect(w.find('.sidebar').classes()).toContain('collapsed')

    w.findComponent(SidebarNav).vm.$emit('update:collapsed', false)
    await flushPromises()
    expect(wslAPI.config.set).toHaveBeenCalledWith('uiState', { sidebarCollapsed: false })
  })

  it('uiState 读取失败不阻断布局（默认展开）', async () => {
    wslAPI.config.get.mockRejectedValue(new Error('配置读不动'))
    const w = mount(DefaultLayout, {
      attachTo: document.body,
      global: { stubs: { 'router-view': true } },
    })
    await flushPromises()
    expect(w.find('.layout').exists()).toBe(true)
    expect(w.find('.sidebar').classes()).not.toContain('collapsed')
  })

  it('快捷键 ⌘N 无可用发行版时如实提示，不静默', async () => {
    mount(DefaultLayout, {
      attachTo: document.body,
      global: { stubs: { 'router-view': true } },
    })
    await flushPromises()
    keydown(window, 'n', { ctrlKey: true })
    await flushPromises()
    expect(message.warning).toHaveBeenCalledWith('没有可用的发行版')
    expect(wslAPI.terminal.create).not.toHaveBeenCalled()
  })

  it('快捷键 ⌘N 建终端成功后跳转终端页；失败走错误提示', async () => {
    // 终端只服务运行中发行版（review 状态门禁）：夹具 Running 才能建会话
    useDistrosStore().items = [distro({ state: 'Running' })]
    mount(DefaultLayout, {
      attachTo: document.body,
      global: { stubs: { 'router-view': true } },
    })
    await flushPromises()
    keydown(window, 'n', { ctrlKey: true })
    await flushPromises()
    expect(wslAPI.terminal.create).toHaveBeenCalled()
    expect(routerMock.push).toHaveBeenCalledWith('/terminal')

    wslAPI.terminal.create.mockRejectedValueOnce(appError('pty 炸了'))
    keydown(window, 'n', { ctrlKey: true })
    await flushPromises()
    // 错误自带 message → 如实展示根因（errorLine 不吞真实原因）
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('pty 炸了'))
  })

  it('设置落盘/加载失败统一 Toast（错误态展示，不静默失效）', async () => {
    mount(DefaultLayout, {
      attachTo: document.body,
      global: { stubs: { 'router-view': true } },
    })
    await flushPromises()
    const settings = useSettingsStore()
    // 无 message 的 AppError → 落到兜底文案（完整语义）
    settings.lastError = { code: 'UNKNOWN', message: '', recoverable: true }
    settings.persistErrorAt = Date.now()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('设置保存失败'))

    message.error.mockClear()
    settings.lastError = { code: 'IO_ERROR', message: '磁盘只读', recoverable: true }
    settings.loadErrorAt = Date.now() + 1
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('磁盘只读'))
  })
})
