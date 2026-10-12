import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { NRadioGroup, NSelect } from 'naive-ui'
import { defaultConfig, type ConfigKey, type DistroView, type WslAction } from '@wslpilot/shared'

// 每个用例后自动卸载（teleport 到 body 的内容随之摘除，杜绝跨用例 DOM 污染）
enableAutoUnmount(afterEach)

/**
 * 修复回归钉（半成品 / 状态诚实专项）：
 * A2 安装更新 await · A4 命令面板确认/详情跳转/最近使用顺序 · A5 wsl.conf 丢弃确认
 * · A6 无会话工具栏 · A7 任务详情回退 · A8 新建终端下拉同步 · A9 详情弹窗空态/转换/文案
 * · A10 动作面板 dialog 确认 · A11 备份错误态与迁移目录
 * · B1 编辑元数据 meta.get 预填（防快照旧数据覆盖） · B2 Dashboard 版本探测失败不炸页
 */

// ── naive-ui 可编程确认结果 ──
let dialogResult = true
const message = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
const dialog = {
  warning: vi.fn((opts: { onPositiveClick?: () => void; onNegativeClick?: () => void }) => {
    if (dialogResult) opts.onPositiveClick?.()
    else opts.onNegativeClick?.()
  }),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}
const notification = { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }
const confirmSpy = vi.fn(() => true)
;(globalThis as any).window.confirm = confirmSpy

vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useMessage: () => message,
    useDialog: () => dialog,
    useNotification: () => notification,
  }
})

const routeMock = { query: {} as Record<string, unknown> }
const routerMock = { push: vi.fn() }
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => routeMock,
}))

function appError(msg: string) {
  return { code: 'TASK_FAILED', message: msg, recoverable: true }
}

const wslAPI = {
  app: {
    getVersion: vi.fn(async () => '0.1.0'),
    getWslVersion: vi.fn(async () => ({ wslVersion: '2.3.4', kernelVersion: '5.15.153', raw: '' })),
    signatureStatus: vi.fn(async () => ({ checked: true, signed: true, detail: '' })),
    openPath: vi.fn(async () => {}),
    openConfigDir: vi.fn(async () => {}),
    pickDirectory: vi.fn(async () => null),
    pickSaveFile: vi.fn(async () => null),
    pickOpenFile: vi.fn(async () => null),
    onNavigate: vi.fn(() => () => {}),
  },
  config: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => ({})),
    openExternal: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {}),
    onConflict: vi.fn(() => () => {}),
    resolveConflict: vi.fn(async () => ({})),
  },
  distros: {
    list: vi.fn(async (): Promise<DistroView[]> => []),
    start: vi.fn(async () => {}),
    terminate: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    setDefault: vi.fn(async () => {}),
    unregister: vi.fn(async () => {}),
    registryDetail: vi.fn(async (): Promise<Record<string, unknown>> => ({ values: {} })),
    install: vi.fn(async () => ({ taskId: 'ins' })),
    setVersion: vi.fn(async () => ({ taskId: 'cv' })),
  },
  metrics: {
    sample: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
    sampleOverview: vi.fn(async () => ({
      runningCount: 0,
      totalCount: 0,
      memUsedKB: 0,
      memTotalKB: 0,
      diskUsedKB: 0,
      diskTotalKB: 0,
      cpuPercent: 0,
      sampledAt: 't',
      perDistro: {},
    })),
  },
  io: {
    export: vi.fn(async () => ({ taskId: 'e' })),
    import: vi.fn(async () => ({ taskId: 'i' })),
    move: vi.fn(async () => ({ taskId: 'm' })),
    listBackups: vi.fn(async () => []),
    cleanupBackups: vi.fn(async () => ({ removed: 0 })),
  },
  task: { cancel: vi.fn(async () => true), onProgress: vi.fn(() => () => {}) },
  actions: {
    list: vi.fn(async (): Promise<WslAction[]> => []),
    save: vi.fn(async () => ({})),
    run: vi.fn(async () => ({ taskId: 'a' })),
  },
  terminal: {
    create: vi.fn(async () => ({ ptyId: 'p1', distro: 'Ubuntu', createdAt: Date.now() })),
    kill: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    maxSessions: vi.fn(async () => 10),
    onData: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
  },
  wslconf: {
    read: vi.fn(async () => '[automount]\nenabled = true\n'),
    write: vi.fn(async () => ({ terminated: false })),
  },
  fs: {
    readDir: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    read: vi.fn(async () => ({ text: '', sizeBytes: 0, truncated: false, binary: false })),
    write: vi.fn(async () => {}),
    revealInExplorer: vi.fn(async () => {}),
  },
  update: {
    status: vi.fn(
      async () => ({ status: 'idle', currentVersion: '0.1.0' }) as Record<string, unknown>,
    ),
    check: vi.fn(async () => ({ status: 'not-available', currentVersion: '0.1.0' })),
    download: vi.fn(async () => ({ status: 'idle', currentVersion: '0.1.0' })),
    install: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {}),
  },
  diagnostics: { openLogsDir: vi.fn(async () => {}), exportPackage: vi.fn(async () => null) },
  meta: {
    get: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
    set: vi.fn(async () => ({})),
  },
}
;(globalThis as any).window.wslAPI = wslAPI

const { createPinia, setActivePinia } = await import('pinia')
const { useTasksStore } = await import('../../src/renderer/stores/tasks')
const { useActionsStore } = await import('../../src/renderer/stores/actions')
const { useDistrosStore } = await import('../../src/renderer/stores/distros')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const { useCommandPalette } = await import('../../src/renderer/composables/useCommandPalette')
const TerminalToolbar = (await import('../../src/renderer/features/terminal/TerminalToolbar.vue'))
  .default
const TerminalTabs = (await import('../../src/renderer/features/terminal/TerminalTabs.vue')).default
const TerminalView = (await import('../../src/renderer/views/TerminalView.vue')).default
const TaskDrawer = (await import('../../src/renderer/features/tasks/TaskDrawer.vue')).default
const WslConfPanel = (await import('../../src/renderer/features/config/WslConfPanel.vue')).default
const DistroDetailModal = (
  await import('../../src/renderer/features/distros/DistroDetailModal.vue')
).default
const CommandPalette = (await import('../../src/renderer/features/command/CommandPalette.vue'))
  .default
const ActionsPanel = (await import('../../src/renderer/features/actions/ActionsPanel.vue')).default
const BackupView = (await import('../../src/renderer/views/BackupView.vue')).default
const MoveWizard = (await import('../../src/renderer/features/backup/MoveWizard.vue')).default
const SettingsView = (await import('../../src/renderer/views/SettingsView.vue')).default
const DistrosView = (await import('../../src/renderer/views/DistrosView.vue')).default
const DashboardView = (await import('../../src/renderer/views/DashboardView.vue')).default

function distro(over: Partial<DistroView> = {}): DistroView {
  return {
    name: 'Ubuntu',
    state: 'Stopped',
    version: 2,
    isDefault: false,
    meta: {
      name: 'Ubuntu',
      alias: '',
      tags: [],
      color: '',
      icon: 'linux',
      note: '',
      startupCwd: '~',
      pinned: false,
      quickActions: [],
    },
    ...over,
  }
}

/** 可控 confirmDiscard 的面板替身：模拟 wsl.conf 面板的脏编辑守卫（不涉及真实读取） */
let guardResult = true
const DirtyGuardStub = defineComponent({
  name: 'DirtyGuardStub',
  setup(_props, { expose }) {
    expose({ confirmDiscard: () => Promise.resolve(guardResult) })
    return () => null
  },
})

interface BtnLike {
  text(): string
  element: { hasAttribute(name: string): boolean; click(): void }
}

function findButton(root: { findAll(sel: string): BtnLike[] }, label: string): BtnLike | null {
  return root.findAll('button').find((b) => b.text().includes(label)) ?? null
}

/** n-modal / n-drawer 内容 teleport 到 body：一律查 document.body */
function bodyText(): string {
  return document.body.textContent ?? ''
}

function findBodyButton(label: string): HTMLButtonElement | null {
  return (
    (Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(label),
    ) as HTMLButtonElement | undefined) ?? null
  )
}

/** 逐个点击布尔开关直到脏态成立（首字段值未知，靠保存按钮启用判定） */
async function makeDirty() {
  const switches = Array.from(document.body.querySelectorAll('.n-switch'))
  for (const el of switches) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    const save = findBodyButton('预览并保存')
    if (save && !save.hasAttribute('disabled')) return
  }
  throw new Error('未能制造 wsl.conf 脏编辑')
}

beforeEach(() => {
  vi.clearAllMocks()
  dialogResult = true
  guardResult = true
  routeMock.query = {}
  useCommandPalette().closePalette()
  setActivePinia(createPinia())
  // 面板读取走运行状态门禁（review：读取绝不隐式启动发行版）——默认 Running，用例可覆写
  useDistrosStore().items = [
    distro({ name: 'Ubuntu', state: 'Running' }),
    distro({ name: 'Debian', state: 'Running' }),
  ]
  // 诚实契约形状复位：按 key 返回完整 ConfigMap（同时清掉用例内自定义实现的泄漏）
  wslAPI.config.get.mockImplementation(async (fileKey?: ConfigKey) => {
    if (!fileKey) return {}
    try {
      return defaultConfig(fileKey)
    } catch {
      return {}
    }
  })
  wslAPI.wslconf.read.mockResolvedValue('[automount]\nenabled = true\n')
  wslAPI.distros.list.mockResolvedValue([])
  wslAPI.actions.list.mockResolvedValue([])
  wslAPI.io.listBackups.mockResolvedValue([])
  wslAPI.terminal.list.mockResolvedValue([])
  wslAPI.fs.readDir.mockResolvedValue([])
  wslAPI.update.status.mockResolvedValue({ status: 'idle', currentVersion: '0.1.0' })
  wslAPI.update.install.mockResolvedValue(undefined)
})

describe('A6 终端工具栏 / 导出', () => {
  it('无会话时清屏/复制/导出禁用；有会话可点', async () => {
    const none = mount(TerminalToolbar, {
      props: { canZoom: false, hasSession: false, fontSize: 14 },
    })
    for (const label of ['清屏', '复制', '导出']) {
      const btn = findButton(none, label)
      expect(btn, label).toBeTruthy()
      expect(btn!.element.hasAttribute('disabled'), label).toBe(true)
    }
    expect(findButton(none, 'A-')!.element.hasAttribute('disabled')).toBe(true)

    const some = mount(TerminalToolbar, {
      props: { canZoom: true, hasSession: true, fontSize: 14 },
    })
    for (const label of ['清屏', '复制', '导出']) {
      expect(findButton(some, label)!.element.hasAttribute('disabled'), label).toBe(false)
    }
    findButton(some, '清屏')!.element.click()
    expect(some.emitted('clear')).toHaveLength(1)
  })

  it('无会话触发导出给出提示（不再静默 return）', async () => {
    const w = mount(TerminalView, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('还没有终端会话')
    w.findComponent(TerminalToolbar).vm.$emit('export')
    await flushPromises()
    expect(message.warning).toHaveBeenCalledWith('没有活动的终端会话，无法导出')
  })
})

describe('A8 TerminalTabs 新建下拉同步', () => {
  /** 打开「+ 新建」弹层，让下拉真正渲染 */
  async function openNewPopover(w: ReturnType<typeof mount>) {
    findButton(w, '新建')!.element.click()
    await flushPromises()
  }

  it('distros 异步到达后下拉不再为空', async () => {
    const w = mount(TerminalTabs, {
      props: {
        sessions: [],
        activeId: '',
        maxSessions: 10,
        distroOptions: [],
        defaultDistro: '',
      },
      attachTo: document.body,
    })
    await openNewPopover(w)
    expect(w.findComponent(NSelect).props('value')).toBe('')

    await w.setProps({
      distroOptions: [{ label: 'Ubuntu', value: 'Ubuntu' }],
      defaultDistro: 'Ubuntu',
    })
    await flushPromises()
    expect(w.findComponent(NSelect).props('value')).toBe('Ubuntu')
  })

  it('用户已选的发行版不被后续同步覆盖', async () => {
    const w = mount(TerminalTabs, {
      props: {
        sessions: [],
        activeId: '',
        maxSessions: 10,
        distroOptions: [
          { label: 'Ubuntu', value: 'Ubuntu' },
          { label: 'Debian', value: 'Debian' },
        ],
        defaultDistro: 'Ubuntu',
      },
      attachTo: document.body,
    })
    await openNewPopover(w)
    w.findComponent(NSelect).vm.$emit('update:value', 'Debian')
    await w.setProps({
      distroOptions: [
        { label: 'Ubuntu', value: 'Ubuntu' },
        { label: 'Debian', value: 'Debian' },
        { label: 'Alpine', value: 'Alpine' },
      ],
    })
    await flushPromises()
    expect(w.findComponent(NSelect).props('value')).toBe('Debian')
  })

  it('拖拽排序只认左键：右键横移不重排（review 根治）', async () => {
    const sessions = [
      { ptyId: 'p1', title: 'A', distro: 'A', createdAt: 0, alive: true },
      { ptyId: 'p2', title: 'B', distro: 'B', createdAt: 0, alive: true },
    ]
    const w = mount(TerminalTabs, {
      props: { sessions, activeId: 'p1', maxSessions: 10, distroOptions: [], defaultDistro: '' },
      attachTo: document.body,
    })
    await flushPromises()
    const tabs = Array.from(document.body.querySelectorAll<HTMLElement>('.tab'))
    expect(tabs).toHaveLength(2)

    // 右键按下 + 大幅横移 → 不得 emit reorder
    tabs[0]!.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await flushPromises()
    expect(w.emitted('reorder')).toBeUndefined()

    // 左键按下 + 大幅横移 → 正常重排（真实行为保留）
    tabs[0]!.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await flushPromises()
    expect(w.emitted('reorder')).toBeTruthy()
    expect(w.emitted('reorder')![0]).toEqual([0, 1])
  })
})

describe('A7 TaskDrawer 选中项失效回退', () => {
  function bodyItems(): HTMLElement[] {
    return Array.from(document.body.querySelectorAll('li.item'))
  }

  it('selectedId 指向被 trimFinished 淘汰的任务时回退到最新一条', async () => {
    const tasks = useTasksStore()
    for (let i = 1; i <= 10; i++) {
      tasks.applyProgress({
        taskId: `t${i}`,
        type: 'export',
        distro: 'U',
        percent: 100,
        message: `m${i}`,
        status: 'success',
      })
    }
    // t1 为最旧（trim 时最先被淘汰）
    tasks.entries.forEach((e, i) => (e.startedAt = 1000 + i))

    mount(TaskDrawer, {
      props: { show: true },
      attachTo: document.body,
    })
    await flushPromises()
    const items = bodyItems()
    expect(items).toHaveLength(10)
    // 列表最新在前：末条 = t1（最旧）
    items[9]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(bodyText()).toContain('导出备份')

    // 新任务完成 → trimFinished 淘汰 t1
    tasks.applyProgress({
      taskId: 't11',
      type: 'import',
      distro: 'U',
      percent: 100,
      message: 'm11',
      status: 'success',
    })
    await flushPromises()
    expect(bodyItems()).toHaveLength(10)
    // 详情区自动回退到仍存在的最新任务（不再是消失态）
    expect(document.body.querySelector('.detail-title')?.textContent).toContain('导入恢复')
    const active = bodyItems().find((li) => li.classList.contains('active'))
    expect(active!.textContent).toContain('m11')
  })

  it('取消成功路径给成功提示（此前只覆盖了失败面）', async () => {
    const tasks = useTasksStore()
    tasks.applyProgress({
      taskId: 'live-1',
      type: 'export',
      distro: 'Ubuntu',
      percent: 50,
      message: '导出中',
      status: 'running',
    })
    mount(TaskDrawer, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    findBodyButton('取消')!.click()
    await flushPromises()
    expect(wslAPI.task.cancel).toHaveBeenCalledWith('live-1')
    expect(message.success).toHaveBeenCalledWith('已请求取消任务')
  })

  it('任务列表键盘可达：Enter/Space 选中（role=option 的 a11y 闭环）', async () => {
    const tasks = useTasksStore()
    tasks.applyProgress({
      taskId: 'k1',
      type: 'export',
      distro: 'U',
      percent: 100,
      message: '旧任务',
      status: 'success',
    })
    tasks.applyProgress({
      taskId: 'k2',
      type: 'import',
      distro: 'U',
      percent: 100,
      message: '新任务',
      status: 'success',
    })
    tasks.entries.forEach((e, i) => (e.startedAt = 1000 + i))
    mount(TaskDrawer, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    const items = bodyItems() // 最新在前：items[1] = 旧任务 k1
    expect(items[1]!.getAttribute('tabindex')).toBe('0')
    items[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(items[1]!.classList.contains('active')).toBe(true)
    expect(document.body.querySelector('.detail-title')?.textContent).toContain('导出备份')
  })

  it('空任务列表展示空态，且不存在选中详情', async () => {
    mount(TaskDrawer, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    expect(bodyText()).toContain('暂无任务')
    expect(document.body.querySelector('.detail-title')).toBeNull()
  })
})

describe('A5 WslConfPanel 未保存修改守卫', () => {
  it('切发行版且有脏编辑时先确认；留在此页 → 还原选择且不重载', async () => {
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await makeDirty()
    const reads = wslAPI.wslconf.read.mock.calls.length

    dialogResult = false // 留在此页
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: '放弃未保存的修改？' }),
    )
    expect(w.emitted('restore-distro')![0]).toEqual(['Ubuntu'])
    expect(wslAPI.wslconf.read.mock.calls.length).toBe(reads)
  })

  it('确认放弃修改后才重载新发行版', async () => {
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await makeDirty()
    const reads = wslAPI.wslconf.read.mock.calls.length

    dialogResult = true // 放弃修改
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalled()
    expect(w.emitted('restore-distro')).toBeUndefined()
    expect(wslAPI.wslconf.read.mock.calls.length).toBe(reads + 1)
    expect(wslAPI.wslconf.read).toHaveBeenLastCalledWith('Debian')
  })

  it('干净状态下直接切换不弹确认', async () => {
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()
    expect(dialog.warning).not.toHaveBeenCalled()
    expect(wslAPI.wslconf.read).toHaveBeenLastCalledWith('Debian')
  })
})

describe('A9 DistroDetailModal', () => {
  const stubs = { WslConfPanel: true, ActionsPanel: true, FileBrowserPanel: true }

  it('最近任务用中文类型/状态标签（不再渲染英文枚举）', async () => {
    wslAPI.config.get.mockImplementation(async (key?: string) =>
      key === 'state'
        ? {
            lastTaskResult: {
              type: 'convert',
              distro: 'Ubuntu',
              status: 'failed',
              finishedAt: '2026-01-02T03:04:05.000Z',
            },
          }
        : {},
    )
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    const line = document.body.querySelector('.last-task')
    expect(line).toBeTruthy()
    expect(line!.textContent).toContain('版本转换')
    expect(line!.textContent).toContain('失败')
    expect(line!.textContent).not.toContain('convert')
    expect(line!.textContent).not.toContain('failed')
  })

  it('运行中的资源采样走 metrics.sampleDistro（不再直连 window.wslAPI）', async () => {
    const { useMetricsStore } = await import('../../src/renderer/stores/metrics')
    useDistrosStore().items = [distro({ state: 'Running' })]
    wslAPI.metrics.sample.mockResolvedValue({
      memUsedKB: 1,
      memTotalKB: 2,
      diskUsedKB: 3,
      diskTotalKB: 4,
      cpuPercent: 5,
      sampledAt: 't',
    })
    const spy = vi.spyOn(useMetricsStore(), 'sampleDistro')
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    expect(spy).toHaveBeenCalledWith('Ubuntu')
    spy.mockRestore()
  })

  it('distro 缺失时危险操作整组禁用，且不渲染「停止」', async () => {
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ghost' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    for (const label of ['设为默认', '编辑元数据', '注销发行版', '转换为 WSL']) {
      const btn = findBodyButton(label)
      expect(btn, label).toBeTruthy()
      expect(btn!.hasAttribute('disabled'), label).toBe(true)
    }
    expect(findBodyButton('停止')).toBeNull()
    expect(bodyText()).toContain('操作已停用')
  })

  it('运行中的发行版禁用版本转换；已停止时弹 dialog 确认（不用 window.confirm）', async () => {
    useSettingsStore().confirmDestructive = true
    useDistrosStore().items = [distro({ state: 'Running' })]
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    const convertRunning = findBodyButton('转换为 WSL')!
    expect(convertRunning.hasAttribute('disabled')).toBe(true)

    useDistrosStore().items = [distro({ state: 'Stopped' })]
    await flushPromises()
    const convertStopped = findBodyButton('转换为 WSL')!
    expect(convertStopped.hasAttribute('disabled')).toBe(false)
    confirmSpy.mockClear()
    dialog.warning.mockClear()
    convertStopped.click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('转换为 WSL') }),
    )
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(wslAPI.distros.setVersion).toHaveBeenCalled()
  })

  it('wsl.conf 有脏编辑时关窗先确认；留在此页不关闭', async () => {
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs: { ActionsPanel: true, FileBrowserPanel: true } },
    })
    await flushPromises()
    await makeDirty()

    dialogResult = false
    // 用户点弹窗右上角关闭（真实关闭路径）
    const closeBtn = document.body.querySelector<HTMLButtonElement>(
      '.detail-modal .n-card-header__close',
    )
    expect(closeBtn).toBeTruthy()
    closeBtn!.click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: '放弃未保存的修改？' }),
    )
    expect(w.emitted('update:show')).toBeUndefined()
  })

  it('文件页有脏编辑时关窗同样先确认（不再静默丢文件编辑 — review 根治）', async () => {
    wslAPI.fs.readDir.mockResolvedValue([
      { name: 'a.txt', path: '/a.txt', isDirectory: false, size: 3, modifiedAt: 't' },
    ])
    wslAPI.fs.read.mockResolvedValue({ text: 'abc', sizeBytes: 3, truncated: false, binary: false })
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      // 文件面板与 wsl.conf 面板都用真实组件（被测对象）；动作面板 stub
      global: { stubs: { ActionsPanel: true } },
    })
    await flushPromises()

    // 切到「文件」页 → 打开文件 → 编辑出脏态
    const fileTab = Array.from(document.body.querySelectorAll('.n-tabs-tab')).find((el) =>
      (el.textContent ?? '').includes('文件'),
    )
    expect(fileTab).toBeTruthy()
    ;(fileTab as HTMLElement).click()
    await flushPromises()

    const entry = document.body.querySelector<HTMLButtonElement>('.entry')
    expect(entry).toBeTruthy()
    entry!.click()
    await flushPromises()

    const ta = document.body.querySelector<HTMLTextAreaElement>('.editor-textarea')
    expect(ta).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(ta!, 'abcd')
    ta!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    // 关窗：必须走文件页脏编辑确认（留在此页 → 不关闭）
    dialogResult = false
    const closeBtn = document.body.querySelector<HTMLButtonElement>(
      '.detail-modal .n-card-header__close',
    )
    expect(closeBtn).toBeTruthy()
    closeBtn!.click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: '放弃未保存的修改？' }),
    )
    expect(w.emitted('update:show')).toBeUndefined()

    // 确认放弃后才允许关闭
    dialogResult = true
    closeBtn!.click()
    await flushPromises()
    expect(w.emitted('update:show')).toBeTruthy()
    expect(w.emitted('update:show')!.at(-1)).toEqual([false])
  })

  it('文件页签常驻：切走再切回编辑内容与脏标记保留（组件不卸载 — review 0.1.2 审计修复）', async () => {
    wslAPI.fs.readDir.mockResolvedValue([
      { name: 'a.txt', path: '/a.txt', isDirectory: false, size: 3, modifiedAt: 't' },
    ])
    wslAPI.fs.read.mockResolvedValue({
      text: 'abc',
      sizeBytes: 3,
      truncated: false,
      binary: false,
    })
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs: { ActionsPanel: true } },
    })
    await flushPromises()

    const tabOf = (label: string) =>
      Array.from(document.body.querySelectorAll<HTMLElement>('.n-tabs-tab')).find((el) =>
        (el.textContent ?? '').includes(label),
      )
    tabOf('文件')!.click()
    await flushPromises()
    const entry = document.body.querySelector<HTMLButtonElement>('.entry')
    expect(entry).toBeTruthy()
    entry!.click()
    await flushPromises()

    const ta = document.body.querySelector<HTMLTextAreaElement>('.editor-textarea')
    expect(ta).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(ta!, 'abcd')
    ta!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(bodyText()).toContain('未保存')
    const reads = wslAPI.fs.read.mock.calls.length

    // 切去其他页签再切回：display-directive=show 使文件面板常驻，本地 dirty 不得被卸载销毁
    tabOf('配置')!.click()
    await flushPromises()
    tabOf('文件')!.click()
    await flushPromises()

    const ta2 = document.body.querySelector<HTMLTextAreaElement>('.editor-textarea')
    expect(ta2, '文件面板不得因切页签被卸载').toBeTruthy()
    expect(ta2!.value).toBe('abcd')
    expect(bodyText()).toContain('未保存')
    // 组件未重新挂载：不重复读取文件
    expect(wslAPI.fs.read.mock.calls.length).toBe(reads)
  })

  it('编辑元数据：打开表单调用 meta.get 读「当前」元数据预填（不用列表快照旧数据）', async () => {
    useDistrosStore().items = [
      distro({ meta: { ...distro().meta!, alias: '快照别名', note: '快照备注' } }),
    ]
    wslAPI.meta.get.mockReset()
    wslAPI.meta.get.mockResolvedValue({
      name: 'Ubuntu',
      alias: '新鲜别名',
      tags: ['fresh'],
      color: '#123456',
      icon: 'ubuntu',
      note: '新鲜备注',
      startupCwd: '/home/fresh',
      pinned: true,
      quickActions: [],
    })
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    findBodyButton('编辑元数据')!.click()
    await flushPromises()
    // 必须经 meta:get 读回，而非依赖列表快照（防旧数据编辑整表覆盖）
    expect(wslAPI.meta.get).toHaveBeenCalledWith('Ubuntu')
    const aliasInput = document.body.querySelector<HTMLInputElement>('.meta-edit input')
    expect(aliasInput?.value).toBe('新鲜别名')
    const noteArea = document.body.querySelector<HTMLTextAreaElement>('.meta-edit textarea')
    expect(noteArea?.value).toBe('新鲜备注')
  })

  it('meta.get 读失败：回退列表快照预填并如实提示（不静默、不空表单覆盖）', async () => {
    useDistrosStore().items = [
      distro({ meta: { ...distro().meta!, alias: '快照别名', note: '快照备注' } }),
    ]
    wslAPI.meta.get.mockReset()
    wslAPI.meta.get.mockRejectedValue(new Error('distros.jsonc 读失败'))
    message.warning.mockClear()
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    findBodyButton('编辑元数据')!.click()
    await flushPromises()
    expect(wslAPI.meta.get).toHaveBeenCalledWith('Ubuntu')
    // 回退快照：字段仍预填，避免空表单覆盖写回
    const aliasInput = document.body.querySelector<HTMLInputElement>('.meta-edit input')
    expect(aliasInput?.value).toBe('快照别名')
    // 如实提示
    expect(message.warning).toHaveBeenCalled()
  })

  it('元数据编辑控件与 label 程序化关联：8 个控件逐一带 aria-label（review 0.1.2 a11y）', async () => {
    useDistrosStore().items = [distro()]
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    findBodyButton('编辑元数据')!.click()
    await flushPromises()
    const edit = document.body.querySelector('.meta-edit')
    expect(edit).toBeTruthy()
    for (const label of [
      '别名',
      '标签',
      '备注',
      '图标名',
      '品牌色',
      '终端启动目录',
      '快捷动作',
      '置顶',
    ]) {
      expect(edit!.querySelector(`[aria-label="${label}"]`), label).toBeTruthy()
    }
    // 文本域与开关落到真实控件上（非空壳 div）
    expect(edit!.querySelector('textarea[aria-label="备注"]')).toBeTruthy()
    expect(edit!.querySelector('.n-switch[aria-label="置顶"]')).toBeTruthy()
  })

  it('注销发行版调用 distros.unregister（与 wsl --unregister / 通道动词一致）', async () => {
    useSettingsStore().confirmDestructive = false
    useDistrosStore().items = [distro()]
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    findBodyButton('注销发行版')!.click()
    await flushPromises()
    expect(wslAPI.distros.unregister).toHaveBeenCalledWith('Ubuntu')
  })

  it('注销先过脏守卫：留在此页不注销不关窗，确认放弃后才注销并关窗（review 0.1.2 根治）', async () => {
    useSettingsStore().confirmDestructive = false
    useDistrosStore().items = [distro({ name: 'Ubuntu', state: 'Running' })]
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      // WslConfPanel 真身（脏编辑来源）；动作/文件面板 stub
      global: { stubs: { ActionsPanel: true, FileBrowserPanel: true } },
    })
    await flushPromises()
    await makeDirty()

    dialogResult = false
    findBodyButton('注销发行版')!.click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: '放弃未保存的修改？' }),
    )
    expect(wslAPI.distros.unregister).not.toHaveBeenCalled()
    expect(w.emitted('update:show')).toBeUndefined()

    dialogResult = true
    findBodyButton('注销发行版')!.click()
    await flushPromises()
    expect(wslAPI.distros.unregister).toHaveBeenCalledWith('Ubuntu')
    expect(w.emitted('update:show')!.at(-1)).toEqual([false])
  })

  it('版本转换先过脏守卫：守卫拒绝不启动转换，通过后才转换并关窗（review 0.1.2 根治）', async () => {
    useSettingsStore().confirmDestructive = false
    useDistrosStore().items = [distro({ name: 'Ubuntu', state: 'Stopped' })]
    guardResult = false
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: {
        stubs: { WslConfPanel: DirtyGuardStub, ActionsPanel: true, FileBrowserPanel: true },
      },
    })
    await flushPromises()

    findBodyButton('转换为 WSL')!.click()
    await flushPromises()
    expect(wslAPI.distros.setVersion).not.toHaveBeenCalled()
    expect(w.emitted('update:show')).toBeUndefined()

    guardResult = true
    findBodyButton('转换为 WSL')!.click()
    await flushPromises()
    // 夹具为 WSL2 → 转换目标是 WSL1
    expect(wslAPI.distros.setVersion).toHaveBeenCalledWith('Ubuntu', 1)
    expect(w.emitted('update:show')!.at(-1)).toEqual([false])
  })

  it('切换发行版复位编辑态；同开弹窗保持页签，关-开后页签才回概览（review 0.1.2 根治）', async () => {
    useDistrosStore().items = [
      distro({ name: 'Ubuntu', state: 'Running' }),
      distro({ name: 'Debian', state: 'Running' }),
    ]
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    findBodyButton('编辑元数据')!.click()
    await flushPromises()
    expect(document.body.querySelector('.meta-edit')).toBeTruthy()

    const confTab = Array.from(document.body.querySelectorAll('.n-tabs-tab')).find((el) =>
      (el.textContent ?? '').includes('配置'),
    )
    expect(confTab).toBeTruthy()
    ;(confTab as HTMLElement).click()
    await flushPromises()
    const activeTabText = () =>
      document.body.querySelector('.n-tabs-tab--active')?.textContent ?? ''
    expect(activeTabText()).toContain('配置')

    // 同开弹窗内换发行版：编辑态必须复位，页签保持（含 restore-distro 回切场景）
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()
    expect(document.body.querySelector('.meta-edit')).toBeNull()
    expect(activeTabText()).toContain('配置')

    // 只有「关闭 → 打开」才复位页签
    await w.setProps({ show: false })
    await flushPromises()
    await w.setProps({ show: true })
    await flushPromises()
    expect(activeTabText()).toContain('概览')
  })

  it('切换发行版后旧 registryDetail 响应不得覆盖新发行版（代际守卫）', async () => {
    let resolveOld!: (v: Record<string, unknown>) => void
    wslAPI.distros.registryDetail
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce({ guid: 'NEW-DEBIAN', values: {} })
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()
    expect(bodyText()).toContain('NEW-DEBIAN')

    resolveOld({ guid: 'STALE-UBUNTU', values: {} })
    await flushPromises()
    expect(bodyText()).not.toContain('STALE-UBUNTU')
    expect(bodyText()).toContain('NEW-DEBIAN')
  })

  it('启动双击只发起一次（busy 防护）', async () => {
    useDistrosStore().items = [distro({ name: 'Ubuntu', state: 'Stopped' })]
    let release!: () => void
    wslAPI.distros.start.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    const btn = findBodyButton('启动')!
    btn.click()
    btn.click()
    await flushPromises()
    expect(wslAPI.distros.start).toHaveBeenCalledTimes(1)
    release()
    await flushPromises()
  })

  it('注销双击只发起一次（本地 in-flight 锁）', async () => {
    useSettingsStore().confirmDestructive = false
    useDistrosStore().items = [distro()]
    let release!: () => void
    wslAPI.distros.unregister.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    const btn = findBodyButton('注销发行版')!
    btn.click()
    btn.click()
    await flushPromises()
    expect(wslAPI.distros.unregister).toHaveBeenCalledTimes(1)
    release()
    await flushPromises()
  })

  it('转换双击只发起一次（converting 锁）', async () => {
    useSettingsStore().confirmDestructive = false
    useDistrosStore().items = [distro({ name: 'Ubuntu', state: 'Stopped' })]
    let release!: (v: { taskId: string }) => void
    wslAPI.distros.setVersion.mockImplementationOnce(
      () => new Promise<{ taskId: string }>((r) => (release = r)),
    )
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    const btn = findBodyButton('转换为 WSL')!
    btn.click()
    btn.click()
    await flushPromises()
    expect(wslAPI.distros.setVersion).toHaveBeenCalledTimes(1)
    release({ taskId: 'cv' })
    await flushPromises()
  })

  it('连点关闭只弹一次确认（关窗守卫重入锁 — review 0.1.2 根治）', async () => {
    useDistrosStore().items = [distro({ name: 'Ubuntu', state: 'Running' })]
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs: { ActionsPanel: true, FileBrowserPanel: true } },
    })
    await flushPromises()
    await makeDirty()

    const captured: Array<Record<string, unknown>> = []
    const original = dialog.warning.getMockImplementation()!
    dialog.warning.mockImplementation((opts: unknown) => {
      captured.push(opts as Record<string, unknown>)
    })
    try {
      const closeBtn = document.body.querySelector<HTMLButtonElement>(
        '.detail-modal .n-card-header__close',
      )!
      closeBtn.click()
      await flushPromises()
      closeBtn.click()
      await flushPromises()
      expect(captured).toHaveLength(1)
      ;(captured[0]!.onPositiveClick as () => void)()
      await flushPromises()
      expect(w.emitted('update:show')!.at(-1)).toEqual([false])
    } finally {
      dialog.warning.mockImplementation(original)
    }
  })
})

describe('A4 CommandPalette', () => {
  async function openPalette() {
    const w = mount(CommandPalette, { attachTo: document.body })
    useCommandPalette().openPalette()
    await flushPromises()
    return w
  }

  function paletteButton(label: string): HTMLElement {
    const list = Array.from(document.body.querySelectorAll('button'))
    const btn = list.find((b) => (b.textContent ?? '').includes(label))
    expect(btn, label).toBeTruthy()
    return btn as HTMLElement
  }

  const ACTION: WslAction = {
    id: 'a1',
    label: '清缓存',
    scope: 'global',
    program: '/bin/true',
    args: [],
    terminal: false,
    confirm: true,
  }

  it('全部关机必须确认；取消不执行、不进最近使用', async () => {
    useDistrosStore().items = [distro()]
    dialogResult = false
    await openPalette()
    paletteButton('全部关机').click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '全部关机',
        content: expect.stringContaining('wsl --shutdown'),
      }),
    )
    expect(wslAPI.distros.shutdown).not.toHaveBeenCalled()
    expect(wslAPI.config.set).not.toHaveBeenCalled()
  })

  it('确认后执行关机并记入最近使用', async () => {
    useDistrosStore().items = [distro()]
    dialogResult = true
    await openPalette()
    paletteButton('全部关机').click()
    await flushPromises()
    expect(wslAPI.distros.shutdown).toHaveBeenCalledTimes(1)
    expect(wslAPI.config.set).toHaveBeenCalledWith('uiState', {
      recentCommands: ['shutdown-all'],
    })
  })

  it('run 成功后才 persistRecent（顺序：先执行后记录）', async () => {
    useActionsStore().items = [ACTION]
    useActionsStore().loaded = true
    useDistrosStore().items = [distro()]
    dialogResult = true
    await openPalette()
    paletteButton('清缓存').click()
    await flushPromises()
    expect(wslAPI.actions.run).toHaveBeenCalledTimes(1)
    expect(wslAPI.config.set).toHaveBeenCalledTimes(1)
    const runOrder = wslAPI.actions.run.mock.invocationCallOrder[0]!
    const persistOrder = wslAPI.config.set.mock.invocationCallOrder[0]!
    expect(runOrder).toBeLessThan(persistOrder)
  })

  it('run 失败不进最近使用', async () => {
    useActionsStore().items = [ACTION]
    useActionsStore().loaded = true
    useDistrosStore().items = [distro()]
    dialogResult = true
    wslAPI.actions.run.mockRejectedValueOnce(appError('动作炸了'))
    await openPalette()
    paletteButton('清缓存').click()
    await flushPromises()
    expect(message.error).toHaveBeenCalled()
    expect(wslAPI.config.set).not.toHaveBeenCalled()
  })

  it('「查看发行版」跳转并带 detail 参数（打开详情而非只填搜索）', async () => {
    useDistrosStore().items = [distro()]
    await openPalette()
    paletteButton('查看发行版').click()
    await flushPromises()
    expect(routerMock.push).toHaveBeenCalledWith({
      path: '/distros',
      query: { focus: 'Ubuntu', detail: 'Ubuntu' },
    })
  })

  it('最近使用区块渲染；重复项对辅助技术隐藏（aria-hidden/tabindex=-1）且点击可执行', async () => {
    wslAPI.config.get.mockImplementation(async (key?: string) =>
      key === 'uiState' ? { recentCommands: ['nav-dashboard'] } : {},
    )
    await openPalette()
    const groups = Array.from(document.body.querySelectorAll('.palette-group')).map(
      (g) => g.textContent,
    )
    expect(groups).toContain('最近使用')
    const recentBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.palette-item'),
    ).find((b) => (b.textContent ?? '').includes('前往：驾驶舱'))
    expect(recentBtn).toBeTruthy()
    // 与主列表不重复暴露 option（读屏不会读两遍），且不参与键盘焦点循环
    expect(recentBtn!.getAttribute('aria-hidden')).toBe('true')
    expect(recentBtn!.getAttribute('tabindex')).toBe('-1')
    recentBtn!.click()
    await flushPromises()
    expect(routerMock.push).toHaveBeenCalledWith('/dashboard')
  })
})

describe('DistrosView 接住 detail 查询参数', () => {
  it('route.query.detail 打开详情弹窗', async () => {
    routeMock.query = { detail: 'Ubuntu' }
    wslAPI.distros.list.mockResolvedValue([distro()])
    const w = mount(DistrosView, {
      attachTo: document.body,
      global: { stubs: { DistroDetailModal: true } },
    })
    await flushPromises()
    const modal = w.findComponent(DistroDetailModal)
    expect(modal.props('show')).toBe(true)
    expect(modal.props('distroName')).toBe('Ubuntu')
  })
})

describe('A10 ActionsPanel 危险操作 dialog 确认', () => {
  const ACTION: WslAction = {
    id: 'a1',
    label: '清缓存',
    scope: 'distro',
    program: '/bin/rm',
    args: ['-rf', '/tmp/x'],
    terminal: false,
    confirm: true,
  }

  it('运行 confirm 动作先弹 dialog（含等价命令），取消不执行', async () => {
    useActionsStore().items = [ACTION]
    useActionsStore().loaded = true
    dialogResult = false
    const w = mount(ActionsPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    findButton(w, '运行')!.element.click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('清缓存'),
        content: expect.stringContaining('/bin/rm'),
      }),
    )
    expect(wslAPI.actions.run).not.toHaveBeenCalled()
  })

  it('删除动作走 dialog 确认；window.confirm 不再被使用', async () => {
    useActionsStore().items = [ACTION]
    useActionsStore().loaded = true
    dialogResult = true
    confirmSpy.mockClear()
    const w = mount(ActionsPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    findButton(w, '删除')!.element.click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(expect.objectContaining({ title: '删除动作' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(wslAPI.actions.save).toHaveBeenCalled()
  })
})

describe('A11 BackupView', () => {
  it('备份列表读取失败给错误态（不复用空态文案）', async () => {
    wslAPI.io.listBackups.mockRejectedValue(appError('备份目录读不动'))
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    expect(w.find('.backups-error').exists()).toBe(true)
    expect(w.text()).toContain('备份目录读不动')
    expect(w.text()).not.toContain('备份目录里还没有文件')
  })

  it('迁移完成后「打开所在目录」打开目标目录本身', async () => {
    useSettingsStore().confirmDestructive = false
    wslAPI.io.move.mockResolvedValue({ taskId: 'm1' })
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()

    w.findComponent(NRadioGroup).vm.$emit('update:value', 'move')
    await flushPromises()
    w.findComponent(MoveWizard).vm.$emit('update:form', {
      name: 'Ubuntu',
      path: 'D:\\NewHome',
      terminateFirst: true,
    })
    await flushPromises()
    findButton(w, '下一步')!.element.click()
    await flushPromises()
    findButton(w, '下一步')!.element.click()
    await flushPromises()
    findButton(w, '开始迁移磁盘')!.element.click()
    await flushPromises()
    expect(wslAPI.io.move).toHaveBeenCalledWith({
      name: 'Ubuntu',
      path: 'D:\\NewHome',
      terminateFirst: true,
    })

    useTasksStore().applyProgress({
      taskId: 'm1',
      type: 'move',
      distro: 'Ubuntu',
      percent: 100,
      message: '迁移完成',
      status: 'success',
    })
    await flushPromises()
    findButton(w, '打开所在目录')!.element.click()
    await flushPromises()
    // move 的目标就是目录：直接打开 path，而不是它的父目录
    expect(wslAPI.app.openPath).toHaveBeenCalledWith('D:\\NewHome')
  })
})

describe('A2 SettingsView 更新卡', () => {
  it('安装更新拒绝被 await/catch 住并提示（不静默）', async () => {
    wslAPI.update.status.mockResolvedValue({
      status: 'downloaded',
      currentVersion: '0.1.0',
      version: '2.0.0',
      releaseNotes: '- 修复 X',
      percent: 100,
    })
    wslAPI.update.install.mockRejectedValue(appError('安装器退出码 1'))
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('更新内容')
    expect(w.text()).toContain('- 修复 X')

    findButton(w, '重启并安装')!.element.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('安装器退出码 1'))
  })
})

describe('DashboardView · WSL 版本探测失败不炸页（hero 降级）', () => {
  const dashStubs = { InstallDistroModal: true, DistroDetailModal: true }

  it('getWslVersion 失败：页面正常渲染，hero 静默降级为「WSL」（无 unhandled rejection）', async () => {
    wslAPI.app.getWslVersion.mockReset()
    wslAPI.app.getWslVersion.mockRejectedValue(new Error('wsl --version 双失败'))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
      await flushPromises()
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(wslAPI.app.getWslVersion).toHaveBeenCalled()
    // 丢掉 catch 会让探测失败变成 unhandled rejection（改坏必红）
    expect(unhandled).toEqual([])
    // 不炸页：hero 与主内容照常渲染
    expect(bodyText()).toContain('指挥官')
    expect(bodyText()).toContain('WSL')
    // 版本未知时不得出现版本号文案
    expect(bodyText()).not.toContain('WSL 2.3.4')
  })

  it('getWslVersion 成功：hero 显示 WSL 版本与内核', async () => {
    wslAPI.app.getWslVersion.mockReset()
    wslAPI.app.getWslVersion.mockResolvedValue({
      wslVersion: '2.3.4',
      kernelVersion: '5.15.153.1-microsoft-standard-WSL2',
      raw: '',
    })
    mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
    await flushPromises()
    expect(bodyText()).toContain('WSL 2.3.4')
    expect(bodyText()).toContain('内核 5.15.153.1-microsoft-standard-WSL2')
  })
})
