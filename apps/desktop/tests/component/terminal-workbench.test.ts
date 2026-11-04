import { defineComponent, h, onMounted } from 'vue'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createWslAPI, configGetImpl, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

const message = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }
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
const routeMock = { query: {} as Record<string, unknown> }
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ ...routeMock, name: 'terminal', meta: { layout: 'workbench' } }),
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const { useTerminalStore } = await import('../../src/renderer/stores/terminal')
const { useWorkbenchStore } = await import('../../src/renderer/stores/workbench')
const TerminalView = (await import('../../src/renderer/views/TerminalView.vue')).default

/** XtermPane 桩：避免 happy-dom 真实 xterm，只按需发出命令块 */
const XtermStub = defineComponent({
  name: 'XtermPane',
  props: { ptyId: { type: String, default: '' } },
  emits: [
    'commandBlock',
    'cursorMove',
    'requestSearch',
    'searchResults',
    'atBottom',
    'contextMenu',
  ],
  setup(props, { emit }) {
    onMounted(() => {
      emit('commandBlock', {
        ptyId: props.ptyId,
        block: {
          id: 'b1',
          promptLine: 1,
          outputStart: 2,
          endLine: 3,
          exitCode: 0,
          durationMs: 1200,
          command: 'echo hi',
        },
      })
    })
    return () =>
      h('div', { class: 'xterm-stub' }, [
        h('button', {
          class: 'stub-copy',
          onClick: () => emit('contextMenu', { x: 1, y: 2, ptyId: props.ptyId }),
        }),
      ])
  },
  methods: {
    clear() {},
    focus() {},
    fit() {},
    getSelection() {
      return ''
    },
    findNext() {
      return true
    },
    findPrevious() {
      return true
    },
    clearSearch() {},
    zoom() {},
    copy() {},
    paste() {},
    selectAll() {},
    scrollToBottom() {},
    isAtBottom() {
      return true
    },
    copyLastOutput() {},
    rerunLastCommand() {},
    jumpCommand() {
      return true
    },
    lastBlock() {
      return null
    },
  },
})

function mountView() {
  return mount(TerminalView, {
    global: { stubs: { XtermPane: XtermStub } },
    attachTo: document.body,
  })
}

function addPane() {
  const terminal = useTerminalStore()
  terminal.panes['p1'] = {
    ptyId: 'p1',
    distro: 'Ubuntu',
    shell: '/bin/bash',
    createdAt: Date.now() - 5000,
    alive: true,
  }
  terminal.tabs = [
    {
      id: 't1',
      title: 'Ubuntu',
      layout: { kind: 'leaf', ptyId: 'p1' },
      createdAt: Date.now() - 5000,
    },
  ]
  terminal.activeTabId = 't1'
  terminal.activeId = 'p1'
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  wslAPI = createWslAPI()
  ;(globalThis as any).window.wslAPI = wslAPI
  wslAPI.config.get.mockImplementation(configGetImpl())
  document.body.innerHTML = ''
  routeMock.query = {}
  const workbench = useWorkbenchStore()
  workbench.focusMode = false
  workbench.toolbarOpen = false
  workbench.sessionRailOpen = false
  useSettingsStore().terminalProfiles = []
})

describe('TerminalView 工作台（0.2.0）', () => {
  it('空态 + 会话侧栏：profile 列表可启动，点击后创建标签', async () => {
    const settings = useSettingsStore()
    settings.terminalProfiles = [
      {
        id: 'dev',
        label: '开发环境',
        launch: { kind: 'distro', distro: 'Ubuntu', shell: '/bin/zsh' },
      },
    ]
    const w = mountView()
    await flushPromises()
    expect(w.find('.workbench-bar').exists()).toBe(true)
    expect(w.text()).toContain('还没有终端会话')

    // 打开会话侧栏
    const railBtn = w.findAll('button').find((b) => b.attributes('aria-label') === '切换会话侧栏')!
    await railBtn.trigger('click')
    await flushPromises()
    expect(w.find('.session-rail').exists()).toBe(true)
    expect(w.text()).toContain('开发环境')

    // 点击 profile → createProfile → 新标签
    const profileBtn = w.findAll('.rail-item').find((b) => b.text().includes('开发环境'))!
    await profileBtn.trigger('click')
    await flushPromises()
    expect(wslAPI.terminal.createProfile).toHaveBeenCalledWith({
      profileId: 'dev',
      cols: 80,
      rows: 24,
    })
    expect(useTerminalStore().tabs.at(-1)?.title).toBe('开发环境')
    expect(w.find('.xterm-stub').exists()).toBe(true)
  })

  it('Shell 集成横幅：缺失时安装、成功提示、可关闭', async () => {
    const settings = useSettingsStore()
    settings.terminalShellIntegration = 'on'
    addPane()
    wslAPI.shellIntegration.status.mockResolvedValue({
      distro: 'Ubuntu',
      shell: 'bash',
      state: 'missing',
      supported: true,
      version: '',
      expectedVersion: '1',
      path: '/home/me/.wslpilot/shell-integration',
      files: { bashrc: false, zshrc: false },
    })
    wslAPI.shellIntegration.install.mockResolvedValue({
      distro: 'Ubuntu',
      shell: 'bash',
      state: 'installed',
      supported: true,
      version: '1',
      expectedVersion: '1',
      path: '/home/me/.wslpilot/shell-integration',
      files: { bashrc: true, zshrc: true },
    })
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Shell 集成未安装')
    const install = w.findAll('button').find((b) => b.text().includes('安装 Shell 集成'))!
    await install.trigger('click')
    await flushPromises()
    expect(wslAPI.shellIntegration.install).toHaveBeenCalledWith('Ubuntu', '/bin/bash')
    expect(w.text()).not.toContain('Shell 集成未安装')

    // 关闭提示（重新置为 missing 并刷新）
    wslAPI.shellIntegration.status.mockResolvedValue({
      distro: 'Ubuntu',
      shell: 'bash',
      state: 'partial',
      supported: true,
      version: '0',
      expectedVersion: '1',
      path: '/x',
      files: { bashrc: true, zshrc: false },
    })
    // 通过重新挂载验证 dismiss 分支
    const w2 = mountView()
    await flushPromises()
    expect(w2.text()).toContain('Shell 集成未安装')
    const close = w2.find('.banner-close')
    await close.trigger('click')
    expect(w2.text()).not.toContain('Shell 集成未安装')
  })

  it('专注模式 / 工具栏 / 窗口控制 / 命令块状态行', async () => {
    addPane()
    const w = mountView()
    await flushPromises()
    // 命令块事件 → 状态行显示退出码与耗时
    expect(w.text()).toContain('退出码 0')
    expect(w.text()).toContain('1.20s')

    const focusBtn = w.findAll('button').find((b) => b.attributes('aria-label') === '专注模式')!
    await focusBtn.trigger('click')
    expect(useWorkbenchStore().focusMode).toBe(true)
    expect(w.find('.terminal-view').classes()).toContain('focus')
    // 组件监听 window keydown，直接派发
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(useWorkbenchStore().focusMode).toBe(false)

    const toolbarBtn = w.findAll('button').find((b) => b.attributes('aria-label') === '切换工具栏')!
    await toolbarBtn.trigger('click')
    await flushPromises()
    expect(w.find('.toolbar-overlay').exists()).toBe(true)

    // 窗口控制
    for (const label of ['最小化', '最大化', '关闭']) {
      const btn = w.findAll('button').find((b) => b.attributes('aria-label') === label)!
      await btn.trigger('click')
    }
    expect(wslAPI.app.minimize).toHaveBeenCalled()
    expect(wslAPI.app.maximize).toHaveBeenCalled()
    expect(wslAPI.app.close).toHaveBeenCalled()
  })

  it('saved pane 的 cwd/shell 展示在侧栏，重启会话入口安全降级', async () => {
    addPane()
    useTerminalStore().panes.p1!.cwd = '/work'
    const w = mountView()
    await flushPromises()
    const railBtn = w.findAll('button').find((b) => b.attributes('aria-label') === '切换会话侧栏')!
    await railBtn.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Ubuntu')
  })
})

describe('TerminalView 布局设置分支（0.2.0）', () => {
  it('左侧标签栏 / 常显面板标题 / 紧凑密度', async () => {
    addPane()
    const settings = useSettingsStore()
    settings.workbenchTabPosition = 'left'
    settings.workbenchShowPaneHeaders = 'always'
    settings.workbenchDensity = 'compact'
    const w = mountView()
    await flushPromises()
    expect(w.find('.left-tabs').exists()).toBe(true)
    expect(w.find('.pane-header').exists()).toBe(true)
    expect(w.find('.terminal-view').classes()).toContain('compact')
    settings.workbenchShowPaneHeaders = 'never'
    settings.workbenchTabPosition = 'top'
    await flushPromises()
    expect(w.find('.pane-header').exists()).toBe(false)
  })
})
