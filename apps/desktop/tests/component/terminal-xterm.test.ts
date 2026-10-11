import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { createWslAPI, appError, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

/**
 * XtermPane（@xterm 全量 mock）+ TerminalToolbar 事件面。
 * 断言观测真实行为：构造 Terminal 的选项、write 的缓冲、input/resize 的 IPC 参数。
 */

// ── @xterm 家族 mock：记录构造参数与行为 ──
interface FakeTerm {
  options: Record<string, unknown>
  unicode: { activeVersion: string }
  written: string[]
  disposed: boolean
  handlers: Record<string, (...a: unknown[]) => void>
  buffer: { active: { cursorX: number; cursorY: number } }
}
const terms: FakeTerm[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {}
    unicode = { activeVersion: '' }
    written: string[] = []
    disposed = false
    handlers: Record<string, (...a: unknown[]) => void> = {}
    buffer = { active: { cursorX: 3, cursorY: 5 } }
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts }
      terms.push(this as unknown as FakeTerm)
    }
    loadAddon() {}
    open() {}
    write(s: string) {
      this.written.push(s)
    }
    onData(fn: (...a: unknown[]) => void) {
      this.handlers.data = fn
    }
    onResize(fn: (...a: unknown[]) => void) {
      this.handlers.resize = fn
    }
    onCursorMove(fn: (...a: unknown[]) => void) {
      this.handlers.cursor = fn
    }
    onSelectionChange(fn: (...a: unknown[]) => void) {
      this.handlers.selection = fn
    }
    getSelection() {
      return (this as unknown as FakeTerm & { sel?: string }).sel ?? ''
    }
    clear() {
      ;(this as unknown as { cleared?: boolean }).cleared = true
    }
    focus() {}
    dispose() {
      this.disposed = true
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext() {
      return true
    }
    findPrevious() {
      return true
    }
  },
}))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))

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

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { createPinia, setActivePinia } = await import('pinia')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const XtermPane = (await import('../../src/renderer/features/terminal/XtermPane.vue')).default
const TerminalToolbar = (await import('../../src/renderer/features/terminal/TerminalToolbar.vue'))
  .default

function lastTerm(): FakeTerm {
  const t = terms[terms.length - 1]
  expect(t, '应已构造 Terminal 实例').toBeTruthy()
  return t!
}

beforeEach(() => {
  vi.clearAllMocks()
  terms.length = 0
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

describe('XtermPane', () => {
  it('挂载构造 Terminal：禁用 convertEol、开启 Unicode11、回放 initialBuffer', async () => {
    mount(XtermPane, {
      props: { ptyId: 'p1', initialBuffer: '历史输出\n', prefs: { fontSize: 15 } },
      attachTo: document.body,
    })
    await flushPromises()
    const t = lastTerm()
    expect(t.options.convertEol).toBe(false)
    expect(t.options.allowProposedApi).toBe(true)
    expect(t.options.fontSize).toBe(15)
    expect(t.unicode.activeVersion).toBe('11')
    expect(t.written).toContain('历史输出\n')
  })

  it('终端输入经 IPC 上送；发送失败给错误提示（错误态）', async () => {
    mount(XtermPane, { props: { ptyId: 'p9' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    t.handlers.data!('whoami\n')
    await flushPromises()
    expect(wslAPI.terminal.input).toHaveBeenCalledWith('p9', 'whoami\n')

    // 错误自带 message：如实展示根因；无 message 的拒绝才落到兜底文案
    wslAPI.terminal.input.mockRejectedValueOnce(appError('pty 断开'))
    t.handlers.data!('ls\n')
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('pty 断开'))

    wslAPI.terminal.input.mockRejectedValueOnce(new Error(''))
    t.handlers.data!('cd\n')
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith('终端输入发送失败')
  })

  it('resize 上送被夹到 IPC schema 上限内（500x200）', async () => {
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    lastTerm().handlers.resize!({ cols: 999, rows: 400 })
    await flushPromises()
    expect(wslAPI.terminal.resize).toHaveBeenCalledWith('p1', 500, 200)
  })

  it('onData/onExit 订阅按 ptyId 过滤；退出码写进屏幕', async () => {
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const dataCb = wslAPI.terminal.onData.mock.calls[0]![0]!
    const exitCb = wslAPI.terminal.onExit.mock.calls[0]![0]!

    dataCb({ ptyId: 'other', chunk: '不该出现' })
    expect(lastTerm().written).not.toContain('不该出现')

    dataCb({ ptyId: 'p1', chunk: 'hello' })
    expect(lastTerm().written).toContain('hello')

    exitCb({ ptyId: 'p1', code: 3 })
    expect(lastTerm().written.join('')).toContain('进程已退出，代码 3')
  })

  it('暴露 API：zoom 走 settings 字号（夹在 8..32），clear 触发 term.clear', async () => {
    const w = mount(XtermPane, {
      props: { ptyId: 'p1', prefs: { fontSize: 32 } },
      attachTo: document.body,
    })
    await flushPromises()
    const settings = useSettingsStore()
    ;(w.vm as unknown as { zoom(d: number): void }).zoom(1)
    await flushPromises()
    expect(settings.terminalFontSize).toBe(32) // 32+1 夹回 32
    ;(w.vm as unknown as { zoom(d: number): void }).zoom(-1)
    await flushPromises()
    expect(settings.terminalFontSize).toBe(31)
    expect(wslAPI.config.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ terminal: expect.objectContaining({ fontSize: 31 }) }),
    )

    const t = lastTerm()
    ;(w.vm as unknown as { clear(): void }).clear()
    expect((t as unknown as { cleared?: boolean }).cleared).toBe(true)
  })

  it('卸载时 dispose Terminal 并解绑订阅（无泄漏）', async () => {
    const w = mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const offData = wslAPI.terminal.onData.mock.results[0]!.value as () => void
    const t = lastTerm()
    w.unmount()
    expect(t.disposed).toBe(true)
    expect(offData).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalToolbar 搜索事件面', () => {
  it('搜索框回车发出 search，上一个/下一个发出对应事件', async () => {
    const w = mount(TerminalToolbar, {
      props: { canZoom: true, hasSession: true, fontSize: 14 },
      attachTo: document.body,
    })
    w.findAll('button')
      .find((b) => b.text().includes('搜索'))!
      .element.click()
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('.search-box input')
    expect(input).toBeTruthy()
    input!.value = 'error'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(w.emitted('search')![0]).toEqual(['error'])

    const prev = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('上一个'),
    )!
    prev.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(w.emitted('searchPrev')).toHaveLength(1)

    const next = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('下一个'),
    )!
    next.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(w.emitted('searchNext')).toHaveLength(1)
  })
})
