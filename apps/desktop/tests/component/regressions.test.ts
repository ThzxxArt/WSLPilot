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
    if (dialogResult) opts.onPositiveClick?.()
    else opts.onNegativeClick?.()
  }),
}
vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useMessage: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }),
    useDialog: () => dialog,
    useNotification: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn() }),
  }
})

const fsApi = {
  readDir: vi.fn(async (): Promise<DirEntry[]> => [
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

function session(ptyId: string, title: string) {
  return { ptyId, title, distro: 'Ubuntu', shell: '/bin/bash', alive: true, createdAt: 0 }
}

beforeEach(() => {
  vi.clearAllMocks()
  dialogResult = true
  setActivePinia(createPinia())
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
        sessions: [session('p1', '旧标题'), session('p2', '另一个')],
        activeId: 'p1',
        maxSessions: 10,
        distroOptions: [{ label: 'Ubuntu', value: 'Ubuntu' }],
        defaultDistro: 'Ubuntu',
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

  it('截断文件禁止保存（防止把前缀写回截断原文件）', async () => {
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
    const save = w.findAll('button').find((b) => b.text().includes('保存'))
    expect(save!.attributes('disabled')).toBeDefined()
    // 编辑器不渲染（只读提示替代）
    expect(w.find('textarea').exists()).toBe(false)
  })
})
