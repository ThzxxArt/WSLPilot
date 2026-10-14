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
  cols: number
  rows: number
  handlers: Record<string, (...a: unknown[]) => void>
  buffer: {
    active: { cursorX: number; cursorY: number; viewportY: number; baseY: number }
  }
  customKeyHandler?: (e: KeyboardEvent) => boolean
  scrolledToBottom?: boolean
  selectedAll?: boolean
}
const terms: FakeTerm[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {}
    unicode = { activeVersion: '' }
    written: string[] = []
    disposed = false
    cols = 80
    rows = 24
    handlers: Record<string, (...a: unknown[]) => void> = {}
    buffer = { active: { cursorX: 3, cursorY: 5, viewportY: 24, baseY: 24 } }
    customKeyHandler?: (e: KeyboardEvent) => boolean
    scrolledToBottom = false
    selectedAll = false
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
    onScroll(fn: (...a: unknown[]) => void) {
      this.handlers.scroll = fn
    }
    attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) {
      this.customKeyHandler = fn
    }
    getSelection() {
      return (this as unknown as FakeTerm & { sel?: string }).sel ?? ''
    }
    selectAll() {
      this.selectedAll = true
    }
    scrollToBottom() {
      this.scrolledToBottom = true
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
/** SearchAddon 实例（供 findNext/选项/计数回调断言） */
const searchInstances: Array<{
  findNext: ReturnType<typeof vi.fn>
  findPrevious: ReturnType<typeof vi.fn>
  clearDecorations: ReturnType<typeof vi.fn>
  cb?: (r: { resultIndex: number; resultCount: number }) => void
}> = []
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = vi.fn(() => true)
    findPrevious = vi.fn(() => true)
    clearDecorations = vi.fn()
    cb?: (r: { resultIndex: number; resultCount: number }) => void
    constructor() {
      searchInstances.push(this as never)
    }
    onDidChangeResults(cb: (r: { resultIndex: number; resultCount: number }) => void) {
      this.cb = cb
      return { dispose: vi.fn() }
    }
  },
}))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))

/** WebglAddon mock（0.1.3）：可注入构造失败（回退路径）与上下文丢失回调 */
const webglInstances: Array<{ lossCb?: () => void; disposed: boolean }> = []
let webglThrow = false
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    lossCb?: () => void
    disposed = false
    constructor() {
      if (webglThrow) throw new Error('no webgl context')
      webglInstances.push(this as never)
    }
    onContextLoss(cb: () => void) {
      this.lossCb = cb
      return { dispose: vi.fn() }
    }
    dispose() {
      this.disposed = true
    }
  },
}))

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
const { resolveTerminalTheme } = await import('../../src/renderer/features/terminal/theme')
const XtermPane = (await import('../../src/renderer/features/terminal/XtermPane.vue')).default
const TerminalToolbar = (await import('../../src/renderer/features/terminal/TerminalToolbar.vue'))
  .default

/** 相对亮度 / 对比度（WCAG 2.x） */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function lastTerm(): FakeTerm {
  const t = terms[terms.length - 1]
  expect(t, '应已构造 Terminal 实例').toBeTruthy()
  return t!
}

beforeEach(() => {
  vi.clearAllMocks()
  terms.length = 0
  searchInstances.length = 0
  webglInstances.length = 0
  webglThrow = false
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

  it('ConPTY 伪影对策：windowsPty 按宿主构建号启用（review 终端错位根治）', async () => {
    // 默认 mock：win32 / 22621 → 启用 conpty 对策
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    expect(lastTerm().options.windowsPty).toEqual({ backend: 'conpty', buildNumber: 22621 })

    // 非 Windows / 无构建号 → 不启用（等价旧行为）
    wslAPI.terminal.host.mockResolvedValueOnce({ platform: 'linux', conptyBuild: null })
    mount(XtermPane, { props: { ptyId: 'p2' }, attachTo: document.body })
    await flushPromises()
    expect(lastTerm().options.windowsPty).toBeUndefined()

    // host() 拒绝也不炸（降级）
    wslAPI.terminal.host.mockRejectedValueOnce(new Error('ipc down'))
    mount(XtermPane, { props: { ptyId: 'p3' }, attachTo: document.body })
    await flushPromises()
    expect(lastTerm().options.windowsPty).toBeUndefined()
  })

  it('挂载竞态封死：host() 未决期间到达的 chunk 入队，按 序回放（初始缓冲→队列→直写）', async () => {
    let releaseHost: (v: { platform: string; conptyBuild: number | null }) => void = () => {}
    wslAPI.terminal.host.mockReturnValueOnce(
      new Promise<{ platform: string; conptyBuild: number | null }>((r) => {
        releaseHost = r
      }),
    )
    mount(XtermPane, {
      props: { ptyId: 'p1', initialBuffer: '缓冲\n' },
      attachTo: document.body,
    })
    // host() 挂起中：订阅已建立（同步段），chunk 进队不丢
    const dataCb = wslAPI.terminal.onData.mock.calls[0]![0]!
    dataCb({ ptyId: 'p1', chunk: '挂起中到达' })
    dataCb({ ptyId: 'p1', chunk: ' 的续块' })
    await flushPromises()
    // 放行 host → 构造 Terminal → 回放
    releaseHost({ platform: 'win32', conptyBuild: 22621 })
    await flushPromises()
    const t = lastTerm()
    const joined = t.written.join('')
    expect(joined.indexOf('缓冲\n')).toBe(0)
    expect(joined).toContain('挂起中到达')
    expect(joined).toContain(' 的续块')
    // 保序：队列块在初始缓冲之后、且互相有序
    expect(joined.indexOf('挂起中到达')).toBeGreaterThan(joined.indexOf('缓冲\n'))
    expect(joined.indexOf(' 的续块')).toBeGreaterThan(joined.indexOf('挂起中到达'))
    // 放行后直写
    dataCb({ ptyId: 'p1', chunk: '直写' })
    expect(lastTerm().written.join('')).toContain('直写')
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
    const t = lastTerm()
    t.cols = 999
    t.rows = 400
    t.handlers.resize!({ cols: 999, rows: 400 })
    await flushPromises()
    expect(wslAPI.terminal.resize).toHaveBeenCalledWith('p1', 500, 200)
  })

  it('尺寸同步必达 + 输出间隙自愈（PTY 停旧宽度即错位 — review 根治）', async () => {
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    // 首次同步建立记账（happy-dom 无布局，走 resize 事件路径等价于 fit 后同步）
    t.handlers.resize!({})
    await flushPromises()
    expect(wslAPI.terminal.resize).toHaveBeenCalledWith('p1', 80, 24)
    ;(wslAPI.terminal.resize as ReturnType<typeof vi.fn>).mockClear()
    // 尺寸漂移（如 fit 后 PTY 尚未拉齐）→ 输出到达时自愈再同步
    t.cols = 120
    t.rows = 30
    const dataCb = wslAPI.terminal.onData.mock.calls[0]![0]!
    dataCb({ ptyId: 'p1', chunk: 'x' })
    await flushPromises()
    expect(wslAPI.terminal.resize).toHaveBeenCalledWith('p1', 120, 30)
    // 已同步后不再重复上送（零成本校验）
    ;(wslAPI.terminal.resize as ReturnType<typeof vi.fn>).mockClear()
    dataCb({ ptyId: 'p1', chunk: 'y' })
    await flushPromises()
    expect(wslAPI.terminal.resize).not.toHaveBeenCalled()
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

  it('host() 未决期间卸载：续体被 disposed 拦截，不创建 Terminal（review 0.1.2 竞态根治）', async () => {
    let releaseHost!: (v: { platform: string; conptyBuild: number | null }) => void
    wslAPI.terminal.host.mockReturnValueOnce(
      new Promise((r) => {
        releaseHost = r
      }),
    )
    const w = mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    // 订阅在同步段建立（卸载路径负责解绑）
    const offData = wslAPI.terminal.onData.mock.results[0]!.value as () => void
    w.unmount()
    // 卸载后才放行 host()：续体不得再 new Terminal / open 空 host
    releaseHost({ platform: 'win32', conptyBuild: 22621 })
    await flushPromises()
    expect(terms).toHaveLength(0)
    expect(offData).toHaveBeenCalledTimes(1)
  })

  it('syncPtySize 单飞：并发尺寸同步只发一次 IPC（review 0.1.2 根治）', async () => {
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    let releaseResize!: () => void
    wslAPI.terminal.resize.mockReturnValueOnce(
      new Promise<void>((r) => {
        releaseResize = r
      }),
    )
    // 连发两次 resize：第二次复用第一次的在途同步，不重复上送
    t.handlers.resize!({})
    t.handlers.resize!({})
    await flushPromises()
    expect(wslAPI.terminal.resize).toHaveBeenCalledTimes(1)
    releaseResize()
    await flushPromises()
  })

  it('飞行中尺寸再次变化：settle 后补发一轮，PTY 最终收到最后一次尺寸（尾沿补偿 — review 0.1.2 审计修复）', async () => {
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    // 先建立记账（80×24），避免把初始化同步误算成尾沿漂移
    t.handlers.resize!({})
    await flushPromises()
    ;(wslAPI.terminal.resize as ReturnType<typeof vi.fn>).mockClear()

    let releaseFirst!: () => void
    wslAPI.terminal.resize.mockReturnValueOnce(
      new Promise<void>((r) => {
        releaseFirst = r
      }),
    )
    t.cols = 100
    t.rows = 30
    t.handlers.resize!({})
    await flushPromises()
    expect(wslAPI.terminal.resize).toHaveBeenCalledTimes(1)

    // 飞行中尺寸再次变化：单飞复用旧 promise（不重复 IPC）
    t.cols = 120
    t.rows = 40
    t.handlers.resize!({})
    await flushPromises()
    expect(wslAPI.terminal.resize).toHaveBeenCalledTimes(1)

    // 放行首轮：settle 后必须复查 drifted 并补发一轮（否则此后无输出/无 resize 就停留旧尺寸）
    releaseFirst()
    await flushPromises()
    expect(wslAPI.terminal.resize).toHaveBeenCalledTimes(2)
    expect(wslAPI.terminal.resize).toHaveBeenLastCalledWith('p1', 120, 40)
  })

  it('尺寸同步失败节流：同一失败只提示一次，成功后重置（review 0.1.2 根治）', async () => {
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    wslAPI.terminal.resize.mockRejectedValue(new Error('size down'))
    t.handlers.resize!({})
    await new Promise((r) => setTimeout(r, 350))
    expect(message.error).toHaveBeenCalledTimes(1)
    // 同一失败再次触发（输出自愈路径）：节流不重复提示
    t.handlers.resize!({})
    await new Promise((r) => setTimeout(r, 350))
    expect(message.error).toHaveBeenCalledTimes(1)
    // 成功同步一次 → 重置节流；后续新的失败可再次提示
    wslAPI.terminal.resize.mockResolvedValue(undefined)
    t.cols = 100
    t.handlers.resize!({})
    await flushPromises()
    wslAPI.terminal.resize.mockRejectedValue(new Error('size down 2'))
    t.cols = 101
    t.handlers.resize!({})
    await new Promise((r) => setTimeout(r, 350))
    expect(message.error).toHaveBeenCalledTimes(2)
  })

  it('持续失败不链式补发：连发触发落在同一单飞轮，失败轮结束即停手（review 0.1.2 二轮审计）', async () => {
    ;(wslAPI.terminal.resize as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    // 建立尺寸记账（80×24）
    t.handlers.resize!({})
    await flushPromises()
    ;(wslAPI.terminal.resize as ReturnType<typeof vi.fn>).mockClear()

    // 持续失败 + 尺寸漂移：连发 5 次触发，全部复用同一在途单飞轮
    wslAPI.terminal.resize.mockRejectedValue(new Error('size down'))
    t.cols = 100
    t.rows = 30
    for (let i = 0; i < 5; i++) t.handlers.resize!({})
    // 固定重试共 3 次（150ms 间隔），等全部落地
    await new Promise((r) => setTimeout(r, 700))
    expect(wslAPI.terminal.resize).toHaveBeenCalledTimes(3)

    // 失败轮结束后不得链式补发：观察窗口内调用数保持不增（旧实现会失败即续飞 → 无限空转）
    await new Promise((r) => setTimeout(r, 500))
    expect(wslAPI.terminal.resize).toHaveBeenCalledTimes(3)
  })
})

describe('终端主题对比度（4 个主题关键色对 — review 0.1.2 验收）', () => {
  it('正文前景/背景对比度 ≥ 4.5:1（ANSI 彩色为装饰性例外，不参与断言）', () => {
    const themes = [
      { name: 'light（auto）', t: resolveTerminalTheme('auto') },
      { name: 'contrast（custom）', t: resolveTerminalTheme('custom') },
      { name: 'follow-app（aurora）', t: resolveTerminalTheme('follow-app', 'aurora') },
      { name: 'follow-app（ocean）', t: resolveTerminalTheme('follow-app', 'ocean') },
    ]
    for (const { name, t } of themes) {
      const ratio = contrastRatio(t.foreground!, t.background!)
      expect(ratio, `${name} 对比度 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('TerminalToolbar 搜索事件面', () => {
  it('搜索框输入即搜索（携带选项），Enter/Shift+Enter 上一个/下一个', async () => {
    const w = mount(TerminalToolbar, {
      props: {
        canZoom: true,
        hasSession: true,
        fontSize: 14,
        atBottom: true,
        searchCount: 0,
        searchIndex: -1,
      },
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
    await flushPromises()
    // 0.1.3：输入即搜索，携带大小写/正则选项（默认关闭）
    expect(w.emitted('search')![0]).toEqual([
      { query: 'error', caseSensitive: false, regex: false },
    ])

    input!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    expect(w.emitted('searchNext')).toHaveLength(1)
    input!.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter', shiftKey: true, bubbles: true }),
    )
    expect(w.emitted('searchPrev')).toHaveLength(1)

    // 选项切换以当前查询重新搜索
    const caseBox = Array.from(document.body.querySelectorAll<HTMLElement>('.n-checkbox')).find(
      (el) => (el.textContent ?? '').includes('区分大小写'),
    )!
    caseBox.click()
    await flushPromises()
    const last = w.emitted('search')!.at(-1)![0] as { caseSensitive: boolean }
    expect(last.caseSensitive).toBe(true)

    // 命中计数展示（0.1.3）
    await w.setProps({ searchCount: 12, searchIndex: 2 })
    await flushPromises()
    expect(document.body.textContent).toContain('3/12')
  })

  it('字号到达边界时禁用 A+/A- 且按钮带 aria-label（review 0.1.2 根治）', () => {
    const min = mount(TerminalToolbar, {
      props: {
        canZoom: true,
        hasSession: true,
        fontSize: 8,
        atBottom: true,
        searchCount: 0,
        searchIndex: -1,
      },
    })
    const shrink = min.findAll('button').find((b) => b.text().includes('A-'))!
    const grow = min.findAll('button').find((b) => b.text().includes('A+'))!
    expect(shrink.attributes('aria-label')).toBe('缩小终端字号')
    expect(grow.attributes('aria-label')).toBe('增大终端字号')
    // 8 是下限：A- 禁用、A+ 可用
    expect(shrink.attributes('disabled')).toBeDefined()
    expect(grow.attributes('disabled')).toBeUndefined()

    const max = mount(TerminalToolbar, {
      props: {
        canZoom: true,
        hasSession: true,
        fontSize: 32,
        atBottom: true,
        searchCount: 0,
        searchIndex: -1,
      },
    })
    const shrink2 = max.findAll('button').find((b) => b.text().includes('A-'))!
    const grow2 = max.findAll('button').find((b) => b.text().includes('A+'))!
    // 32 是上限：A+ 禁用、A- 可用
    expect(grow2.attributes('disabled')).toBeDefined()
    expect(shrink2.attributes('disabled')).toBeUndefined()

    // 无会话时 A+/A- 一律禁用（canZoom=false 优先）
    const none = mount(TerminalToolbar, {
      props: {
        canZoom: false,
        hasSession: false,
        fontSize: 16,
        atBottom: true,
        searchCount: 0,
        searchIndex: -1,
      },
    })
    const zoomBtns = none.findAll('button').filter((b) => /A[+-]/.test(b.text()))
    expect(zoomBtns).toHaveLength(2)
    for (const b of zoomBtns) expect(b.attributes('disabled')).toBeDefined()
  })

  it('0.1.3 新按钮：分屏/关闭面板/粘贴/滚动到底部（贴底时隐藏）', async () => {
    const w = mount(TerminalToolbar, {
      props: {
        canZoom: true,
        hasSession: true,
        fontSize: 14,
        atBottom: false,
        searchCount: 0,
        searchIndex: -1,
      },
    })
    const click = (label: string) => {
      const btn = w.findAll('button').find((b) => b.text().includes(label))!
      expect(btn, label).toBeTruthy()
      btn.element.click()
    }
    click('粘贴')
    expect(w.emitted('paste')).toHaveLength(1)
    click('分屏 ⇢')
    expect(w.emitted('splitRow')).toHaveLength(1)
    click('分屏 ⇣')
    expect(w.emitted('splitCol')).toHaveLength(1)
    click('关闭面板')
    expect(w.emitted('closePane')).toHaveLength(1)
    click('↓ 到底部')
    expect(w.emitted('scrollBottom')).toHaveLength(1)

    // 贴底时「到底部」按钮隐藏
    await w.setProps({ atBottom: true })
    expect(w.findAll('button').find((b) => b.text().includes('到底部'))).toBeUndefined()

    // 4 面板上限双保险（UI 层）：canSplit=false 时两个分屏按钮禁用；默认（省略）为可用
    expect(w.find('button[aria-label="左右分屏"]').attributes('disabled')).toBeUndefined()
    await w.setProps({ canSplit: false })
    expect(w.find('button[aria-label="左右分屏"]').attributes('disabled')).toBeDefined()
    expect(w.find('button[aria-label="上下分屏"]').attributes('disabled')).toBeDefined()
  })
})

describe('XtermPane 0.1.3 增强（快捷键 / 粘贴 / 搜索 / WebGL / 右键）', () => {
  function keydownEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
    return {
      type: 'keydown',
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      code: '',
      preventDefault: vi.fn(),
      ...init,
    } as unknown as KeyboardEvent
  }

  it('Ctrl+Shift+C：有选区复制到主进程剪贴板；无选区提示（0.1.3）', async () => {
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    expect(t.customKeyHandler).toBeTruthy()

    ;(t as unknown as { sel?: string }).sel = 'hello world'
    const handled = t.customKeyHandler!(
      keydownEvent({ ctrlKey: true, shiftKey: true, code: 'KeyC' }),
    )
    expect(handled).toBe(false)
    await flushPromises()
    expect(wslAPI.clipboard.write).toHaveBeenCalledWith('hello world')
    expect(message.success).toHaveBeenCalledWith('已复制')

    ;(t as unknown as { sel?: string }).sel = ''
    message.info.mockClear()
    t.customKeyHandler!(keydownEvent({ ctrlKey: true, shiftKey: true, code: 'KeyC' }))
    await flushPromises()
    expect(wslAPI.clipboard.write).toHaveBeenCalledTimes(1)
    expect(message.info).toHaveBeenCalledWith('请先在终端中选中内容')
  })

  it('Ctrl+Shift+V：读剪贴板并按分片发送（大粘贴不丢字）', async () => {
    mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    wslAPI.clipboard.read.mockResolvedValueOnce('echo hi\n')
    t.customKeyHandler!(keydownEvent({ ctrlKey: true, shiftKey: true, code: 'KeyV' }))
    await flushPromises()
    expect(wslAPI.terminal.input).toHaveBeenCalledWith('p1', 'echo hi\n')
  })

  it('Ctrl+Shift+F：请求父级打开搜索（emit requestSearch）', async () => {
    const w = mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const t = lastTerm()
    t.customKeyHandler!(keydownEvent({ ctrlKey: true, shiftKey: true, code: 'KeyF' }))
    expect(w.emitted('requestSearch')).toHaveLength(1)
  })

  it('搜索：选项透传 SearchAddon（大小写/正则/高亮）与命中计数回调转发', async () => {
    const w = mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const s = searchInstances[0]!
    const vm = w.vm as unknown as {
      findNext(text: string, prefs?: { caseSensitive: boolean; regex: boolean }): boolean
    }
    vm.findNext('abc', { caseSensitive: true, regex: true })
    expect(s.findNext).toHaveBeenCalledWith(
      'abc',
      expect.objectContaining({ caseSensitive: true, regex: true }),
    )
    // 高亮装饰必须总是存在（全部命中高亮 — 0.1.3）
    const opts = s.findNext.mock.calls[0]![1] as { decorations?: Record<string, string> }
    expect(opts.decorations?.matchBackground).toBeTruthy()
    expect(opts.decorations?.activeMatchBackground).toBeTruthy()

    s.cb?.({ resultIndex: 1, resultCount: 5 })
    expect(w.emitted('searchResults')).toEqual([[{ index: 1, count: 5 }]])

    // 清除高亮（关闭搜索）
    ;(w.vm as unknown as { clearSearch(): void }).clearSearch()
    expect(s.clearDecorations).toHaveBeenCalled()
  })

  it('WebGL：构造失败自动回退（不抛不崩）；上下文丢失后 dispose 回退 DOM', async () => {
    webglThrow = true
    mount(XtermPane, { props: { ptyId: 'p-fallback' }, attachTo: document.body })
    await flushPromises()
    expect(terms).toHaveLength(1)
    expect(webglInstances).toHaveLength(0)

    webglThrow = false
    mount(XtermPane, { props: { ptyId: 'p-webgl' }, attachTo: document.body })
    await flushPromises()
    expect(webglInstances).toHaveLength(1)
    webglInstances[0]!.lossCb?.()
    expect(webglInstances[0]!.disposed).toBe(true)
  })

  it('右键：contextmenu 事件携带坐标与 ptyId；滚动/贴底状态上报', async () => {
    const w = mount(XtermPane, { props: { ptyId: 'p1' }, attachTo: document.body })
    await flushPromises()
    const host = document.querySelector<HTMLElement>('.xterm-host')!
    const ev = new MouseEvent('contextmenu', { bubbles: true, clientX: 42, clientY: 24 })
    host.dispatchEvent(ev)
    expect(w.emitted('contextMenu')).toEqual([[{ x: 42, y: 24, ptyId: 'p1' }]])

    const t = lastTerm()
    // 视口贴底 → scroll 回调上报 true
    t.handlers.scroll!()
    expect(w.emitted('atBottom')!.at(-1)).toEqual([true])
    // 视口上移 → false
    t.buffer.active.viewportY = 0
    t.handlers.scroll!()
    expect(w.emitted('atBottom')!.at(-1)).toEqual([false])
  })
})
