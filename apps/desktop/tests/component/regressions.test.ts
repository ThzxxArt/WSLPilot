import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  modifiedAt?: string
}

/**
 * 自查回归用例（review「完整检查所有修复的正确性」）。
 * 这两个 bug 是玥玥在回验自己修复时发现的，必须有用例锁死：
 * 1. 终端标签重命名：Enter 提交后输入框卸载会再触发 blur → 重复 emit；Esc 也会误改名
 * 2. 文件浏览器：goTo 先改 path 再确认，用户点「留在此页」后面包屑与列表不一致
 */

// ── naive-ui 的 useDialog 可编程控制确认结果 ──
let dialogResult = true
const dialog = {
  warning: vi.fn((opts: { onPositiveClick?: () => void; onNegativeClick?: () => void }) => {
    // 与真实契约同形：返回实例含 destroy（用例可挂起/覆写实现）
    const inst = { destroy: vi.fn() }
    if (dialogResult) opts.onPositiveClick?.()
    else opts.onNegativeClick?.()
    return inst
  }),
}
const message = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useMessage: () => message,
    useDialog: () => dialog,
    useNotification: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn() }),
  }
})

const fsApi = {
  readDir: vi.fn(async (_distro: string, _path: string): Promise<DirEntry[]> => [
    { name: 'etc', path: '/etc', isDirectory: true },
    { name: 'hosts', path: '/hosts', isDirectory: false, size: 10 },
  ]),
  read: vi.fn(async () => ({
    text: 'hello',
    sizeBytes: 5,
    truncated: false,
    binary: false,
  })),
  write: vi.fn(async () => {}),
  revealInExplorer: vi.fn(async () => {}),
}
;(globalThis as any).window.wslAPI = {
  fs: fsApi,
  app: { openPath: vi.fn(async () => {}), pickDirectory: vi.fn(async () => null) },
  task: { onProgress: vi.fn(() => () => {}) },
}

const TerminalTabs = (await import('../../src/renderer/features/terminal/TerminalTabs.vue')).default
const FileBrowserPanel = (await import('../../src/renderer/features/fs/FileBrowserPanel.vue'))
  .default

const { createPinia, setActivePinia } = await import('pinia')
const { useDistrosStore } = await import('../../src/renderer/stores/distros')
/** 面板读取走运行状态门禁（review：读取绝不隐式启动发行版）——夹具默认 Running */
const RUNNING = {
  name: 'Ubuntu',
  state: 'Running',
  version: 2,
  isDefault: true,
  meta: null,
} as never

/** 0.1.3：TerminalTabs 消费标签项（标签 = 分屏面板树容器） */
function tabItem(id: string, title: string) {
  return { id, title, alive: true, tooltip: '' }
}

beforeEach(() => {
  vi.clearAllMocks()
  dialogResult = true
  setActivePinia(createPinia())
  useDistrosStore().items = [RUNNING]
  document.body.innerHTML = ''
  fsApi.readDir.mockClear()
  fsApi.readDir.mockResolvedValue([
    { name: 'etc', path: '/etc', isDirectory: true },
    { name: 'hosts', path: '/hosts', isDirectory: false, size: 10 },
  ])
})

describe('终端标签重命名（自查回归）', () => {
  function mountTabs() {
    return mount(TerminalTabs, {
      props: {
        tabs: [tabItem('p1', '旧标题'), tabItem('p2', '另一个')],
        activeTabId: 'p1',
        maxSessions: 10,
        distroOptions: [{ label: 'Ubuntu', value: 'Ubuntu' }],
        defaultDistro: 'Ubuntu',
        defaultShell: '/bin/bash',
      },
      attachTo: document.body,
    })
  }

  /** n-input 的 class 挂在包裹层，真正 input 是后代 */
  function renameInput(): HTMLInputElement | null {
    return document.querySelector<HTMLElement>('.rename-input')?.querySelector('input') ?? null
  }

  async function typeRename(value: string) {
    const input = renameInput()
    expect(input).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input!, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
  }

  it('双击进入编辑态并自动聚焦', async () => {
    const w = mountTabs()
    await w.findAll('[role="tab"]')[0]!.trigger('dblclick')
    await flushPromises()
    expect(renameInput()).toBeTruthy()
    expect(renameInput()!.value).toBe('旧标题')
  })

  it('Enter 提交只 emit 一次（输入框卸载引发的 blur 不得重复触发）', async () => {
    const w = mountTabs()
    const tab = w.findAll('[role="tab"]')[0]!
    await tab.trigger('dblclick')
    await flushPromises()
    await typeRename('新标题')

    await renameInput()!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushPromises()
    // 输入框已被 v-if 卸载，blur 守卫必须生效
    expect(w.emitted('rename')).toHaveLength(1)
    expect(w.emitted('rename')![0]).toEqual(['p1', '新标题'])
  })

  it('Esc 取消不得改名', async () => {
    const w = mountTabs()
    const tab = w.findAll('[role="tab"]')[0]!
    await tab.trigger('dblclick')
    await flushPromises()
    await typeRename('不该生效')

    await renameInput()!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(w.emitted('rename')).toBeUndefined()
  })

  it('未修改标题时提交不 emit', async () => {
    const w = mountTabs()
    await w.findAll('[role="tab"]')[0]!.trigger('dblclick')
    await flushPromises()
    await renameInput()!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(w.emitted('rename')).toBeUndefined()
  })
})

describe('文件浏览器确认语义（自查回归）', () => {
  /** 打开 hosts 并改动，制造脏编辑 */
  async function openDirtyFile(w: ReturnType<typeof mount>) {
    const fileBtn = w.findAll('button.entry').find((b) => b.text().includes('hosts'))
    expect(fileBtn).toBeTruthy()
    await fileBtn!.trigger('click')
    await flushPromises()
    const ta = w.find('textarea')
    if (ta.exists()) {
      await ta.setValue('dirty content')
      await flushPromises()
    }
  }

  it('点「留在此页」时不得切目录（面包屑与列表保持一致）', async () => {
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    const loadsBefore = fsApi.readDir.mock.calls.length

    await openDirtyFile(w)
    expect(w.text()).toContain('未保存')

    dialogResult = false // 用户选「留在此页」
    const rootCrumb = w.findAll('nav.crumbs button').find((b) => b.text().includes('根'))
    expect(rootCrumb).toBeTruthy()
    await rootCrumb!.trigger('click')
    await flushPromises()

    // 取消后：不再读目录，脏编辑仍在
    expect(fsApi.readDir.mock.calls.length).toBe(loadsBefore)
    expect(w.text()).toContain('未保存')
  })

  it('确认丢弃后才允许切换目录', async () => {
    dialogResult = true
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await openDirtyFile(w)
    const loadsBefore = fsApi.readDir.mock.calls.length

    const rootCrumb = w.findAll('nav.crumbs button').find((b) => b.text().includes('根'))
    await rootCrumb!.trigger('click')
    await flushPromises()

    expect(fsApi.readDir.mock.calls.length).toBe(loadsBefore + 1)
  })

  it('进入子目录会重新读取该路径', async () => {
    dialogResult = true
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()

    const entry = w.findAll('button.entry').find((b) => b.text().includes('etc'))
    expect(entry).toBeTruthy()
    await entry!.trigger('click')
    await flushPromises()

    expect(fsApi.readDir).toHaveBeenLastCalledWith('Ubuntu', '/etc')
  })

  it('截断文件只读展示前缀（文案与实现一致）且禁止保存', async () => {
    fsApi.read.mockResolvedValueOnce({
      text: 'prefix only',
      sizeBytes: 9_000_000,
      truncated: true,
      binary: false,
    })
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()

    const fileBtn = w.findAll('button.entry').find((b) => b.text().includes('hosts'))
    await fileBtn!.trigger('click')
    await flushPromises()

    expect(w.text()).toContain('超限截断')
    expect(w.text()).toContain('仅展示前缀')
    const save = w.findAll('button').find((b) => b.text().includes('保存'))
    expect(save!.attributes('disabled')).toBeDefined()
    // 文案称「仅展示前缀」就必须真的渲染前缀：只读编辑器（review 0.1.2 根治）
    const ta = w.find('textarea')
    expect(ta.exists()).toBe(true)
    expect(ta.element.hasAttribute('readonly')).toBe(true)
    expect(ta.element.value).toBe('prefix only')
  })

  it('取消切换发行版：emit restore-distro 回退选择，且不读新发行版（与 WslConfPanel 对齐）', async () => {
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await openDirtyFile(w)
    const loadsBefore = fsApi.readDir.mock.calls.length

    dialogResult = false // 留在此页
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()

    expect(w.emitted('restore-distro')![0]).toEqual(['Ubuntu'])
    expect(fsApi.readDir.mock.calls.length).toBe(loadsBefore)
    // 脏编辑仍在（未静默丢）
    expect(w.text()).toContain('未保存')
  })

  it('跨发行版写回被阻止：文件属于 Ubuntu，props 已是 Debian 时不得写入', async () => {
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await openDirtyFile(w)

    // 取消切换后父级尚未回退：props 已变 Debian，文件仍属 Ubuntu
    dialogResult = false
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()
    message.warning.mockClear()

    const save = w.findAll('button').find((b) => b.text().includes('保存'))!
    await save.trigger('click')
    await flushPromises()

    expect(fsApi.write).not.toHaveBeenCalled()
    expect(message.warning).toHaveBeenCalledWith(expect.stringContaining('阻止跨发行版写回'))
  })

  it('保存期间引用被清空不误报失败（局部快照），且保存中冻结返回/导航', async () => {
    let resolveWrite!: () => void
    fsApi.write.mockImplementationOnce(() => new Promise<void>((r) => (resolveWrite = r)))
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await openDirtyFile(w)

    const save = w.findAll('button').find((b) => b.text().includes('保存'))!
    await save.trigger('click')
    await flushPromises()
    // 写盘在途：返回与面包屑导航必须禁用（review 0.1.2 根治）
    const back = w.findAll('button').find((b) => b.text().includes('← 返回'))!
    expect(back.attributes('disabled')).toBeDefined()
    const rootCrumb = w.findAll('nav.crumbs button').find((b) => b.text().includes('根'))!
    expect(rootCrumb.attributes('disabled')).toBeDefined()

    // 保存期间切换发行版 → 面板 reload 清空 file 引用（父级状态先行变化）
    dialogResult = true
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()
    resolveWrite()
    await flushPromises()

    // 旧实现会在 await 后对已置空的 file.value.dirty 赋值 → TypeError → 假失败（改坏必红）
    expect(message.error).not.toHaveBeenCalled()
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('已保存'))
  })

  it('快速进出目录：旧响应晚到不得覆盖新目录（reload 代际守卫）', async () => {
    let resolveEtc!: (v: DirEntry[]) => void
    fsApi.readDir.mockImplementation((_distro: string, p: string) => {
      if (p === '/etc') return new Promise<DirEntry[]>((r) => (resolveEtc = r))
      return Promise.resolve([
        { name: 'etc', path: '/etc', isDirectory: true },
        { name: 'hosts', path: '/hosts', isDirectory: false, size: 10 },
      ])
    })
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()

    const etc = w.findAll('button.entry').find((b) => b.text().includes('etc'))!
    await etc.trigger('click')
    await flushPromises()
    // /etc 读取在途：立刻返回根目录（第二次读取先完成）
    const rootCrumb = w.findAll('nav.crumbs button').find((b) => b.text().includes('根'))!
    await rootCrumb.trigger('click')
    await flushPromises()

    resolveEtc([{ name: 'stale-entry', path: '/etc/stale', isDirectory: false }])
    await flushPromises()

    expect(w.text()).not.toContain('stale-entry')
    expect(w.text()).toContain('hosts')
  })

  it('二进制文件展示提示、不渲染编辑器且保存禁用（不可在线编辑）', async () => {
    fsApi.read.mockResolvedValueOnce({
      text: '',
      sizeBytes: 128,
      truncated: false,
      binary: true,
    })
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()

    const fileBtn = w.findAll('button.entry').find((b) => b.text().includes('hosts'))
    await fileBtn!.trigger('click')
    await flushPromises()

    expect(w.text()).toContain('二进制文件不支持在线编辑')
    const save = w.findAll('button').find((b) => b.text().includes('保存'))
    expect(save).toBeTruthy()
    expect(save!.attributes('disabled')).toBeDefined()
    // 二进制不渲染编辑器（不给误编辑入口）
    expect(w.find('textarea').exists()).toBe(false)
    expect(fsApi.write).not.toHaveBeenCalled()
  })

  it('写出失败：错误提示可见且不得标记已保存（dirty 保留）', async () => {
    fsApi.write.mockRejectedValueOnce(new Error('权限不足（EACCES）'))
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await openDirtyFile(w)
    expect(w.text()).toContain('未保存')

    const save = w.findAll('button').find((b) => b.text().includes('保存'))!
    await save.trigger('click')
    await flushPromises()

    expect(fsApi.write).toHaveBeenCalledWith('Ubuntu', '/hosts', 'dirty content')
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('权限不足（EACCES）'))
    expect(message.success).not.toHaveBeenCalled()
    // 失败后 dirty 必须保留：绝不把「未保存」误标成已保存
    expect(w.text()).toContain('未保存')
  })

  it('等待确认期间父级回切：旧续体不得载入新发行版（review 0.1.2 审计修复）', async () => {
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await openDirtyFile(w)
    const loads = fsApi.readDir.mock.calls.length

    // 挂起确认框：模拟用户还未点击（await confirmDiscard 在途）
    const captured: Array<Record<string, unknown>> = []
    const original = dialog.warning.getMockImplementation()!
    dialog.warning.mockImplementation((opts: unknown) => {
      captured.push(opts as Record<string, unknown>)
      return { destroy: vi.fn() }
    })
    try {
      await w.setProps({ distroName: 'Debian' })
      await flushPromises()
      expect(captured).toHaveLength(1)

      // 等待期间另一面板 restore-distro 把父级拉回 Ubuntu
      await w.setProps({ distroName: 'Ubuntu' })
      await flushPromises()

      // 用户此刻才点「放弃修改」：Debian 的旧续体必须复验 props 后失效
      ;(captured[0]!.onPositiveClick as () => void)()
      await flushPromises()
      expect(fsApi.readDir.mock.calls.length).toBe(loads)
      expect(fsApi.readDir).not.toHaveBeenCalledWith('Debian', expect.anything())
      // 脏编辑仍在原发行版上（未静默丢）
      expect(w.text()).toContain('未保存')
    } finally {
      dialog.warning.mockImplementation(original)
    }
  })

  it('保存期间编辑器只读；保存成功仅当文本未再变化才清 dirty（假干净根治）', async () => {
    let resolveWrite!: () => void
    fsApi.write.mockImplementationOnce(() => new Promise<void>((r) => (resolveWrite = r)))
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await openDirtyFile(w)

    const save = w.findAll('button').find((b) => b.text().includes('保存'))!
    await save.trigger('click')
    await flushPromises()

    // 写盘在途：编辑器只读，用户无法继续输入制造「假干净」
    const ta = w.find('textarea')
    expect(ta.element.hasAttribute('readonly')).toBe(true)
    // 写盘参数 = 点击时快照
    expect(fsApi.write).toHaveBeenCalledWith('Ubuntu', '/hosts', 'dirty content')

    // 模拟保存期间文本被再次改动（程序化路径）：成功后 dirty 不得被误清
    await ta.setValue('changed during save')
    await flushPromises()
    resolveWrite()
    await flushPromises()

    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('已保存'))
    expect(w.text()).toContain('未保存')
  })

  it('大小写归一：仅大小写不同的发行版名不误拦写回（review 0.1.2 审计修复）', async () => {
    const w = mount(FileBrowserPanel, {
      props: { distroName: 'ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await openDirtyFile(w)

    // 父级把名字规范成 'Ubuntu'（同一发行版）且用户选择留在此页：文件保留
    dialogResult = false
    await w.setProps({ distroName: 'Ubuntu' })
    await flushPromises()
    expect(w.emitted('restore-distro')).toBeTruthy()

    const save = w.findAll('button').find((b) => b.text().includes('保存'))!
    await save.trigger('click')
    await flushPromises()
    // WSL 名不区分大小写：不得报「跨发行版写回」被拦
    expect(fsApi.write).toHaveBeenCalledWith('ubuntu', '/hosts', 'dirty content')
    expect(message.warning).not.toHaveBeenCalledWith(expect.stringContaining('阻止跨发行版写回'))
  })
})
