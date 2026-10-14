import { describe, it, expect, vi, beforeAll } from 'vitest'

const target = new EventTarget()
beforeAll(() => {
  ;(globalThis as any).window = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
})

function key(
  k: string,
  opts: {
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    repeat?: boolean
    code?: string
  } = {},
): Event {
  const e = new Event('keydown', { cancelable: true }) as Event & Record<string, unknown>
  e.key = k
  e.code = opts.code ?? ''
  e.ctrlKey = !!opts.ctrlKey
  e.metaKey = !!opts.metaKey
  e.shiftKey = !!opts.shiftKey
  e.altKey = !!opts.altKey
  e.repeat = !!opts.repeat
  return e
}

const { bindGlobalHotkeys, HOTKEY_TABLE } =
  await import('../../src/renderer/composables/useHotkeys')

function makeHandlers() {
  return {
    openPalette: vi.fn(),
    newTerminal: vi.fn(),
    openSettings: vi.fn(),
    refresh: vi.fn(),
    toggleRawCommand: vi.fn(),
    switchTab: vi.fn(),
  }
}

describe('bindGlobalHotkeys', () => {
  it('Ctrl+K / Ctrl+N / Ctrl+, / Ctrl+R 命中各自 handler', () => {
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, target as never)

    target.dispatchEvent(key('k', { ctrlKey: true }))
    expect(h.openPalette).toHaveBeenCalledTimes(1)

    target.dispatchEvent(key('n', { ctrlKey: true }))
    expect(h.newTerminal).toHaveBeenCalledTimes(1)

    target.dispatchEvent(key(',', { ctrlKey: true }))
    expect(h.openSettings).toHaveBeenCalledTimes(1)

    target.dispatchEvent(key('r', { ctrlKey: true }))
    expect(h.refresh).toHaveBeenCalledTimes(1)

    off()
  })

  it('Meta（⌘）等价于 Ctrl', () => {
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, target as never)
    target.dispatchEvent(key('k', { metaKey: true }))
    expect(h.openPalette).toHaveBeenCalledTimes(1)
    off()
  })

  it('Ctrl+Shift+P 切换等价命令行', () => {
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, target as never)
    target.dispatchEvent(key('p', { ctrlKey: true, shiftKey: true }))
    expect(h.toggleRawCommand).toHaveBeenCalledTimes(1)
    // Ctrl+P 不带 Shift 不触发
    target.dispatchEvent(key('p', { ctrlKey: true }))
    expect(h.toggleRawCommand).toHaveBeenCalledTimes(1)
    off()
  })

  it('Ctrl+1..9 切换标签（0 基下标）', () => {
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, target as never)
    for (const digit of ['1', '5', '9']) {
      target.dispatchEvent(key(digit, { ctrlKey: true }))
    }
    expect(h.switchTab).toHaveBeenCalledTimes(3)
    expect(h.switchTab).toHaveBeenNthCalledWith(1, 0)
    expect(h.switchTab).toHaveBeenNthCalledWith(2, 4)
    expect(h.switchTab).toHaveBeenNthCalledWith(3, 8)
    off()
  })

  it('无修饰键 / Alt 组合不触发；解绑后失效', () => {
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, target as never)
    target.dispatchEvent(key('k'))
    target.dispatchEvent(key('k', { ctrlKey: true, altKey: true }))
    expect(h.openPalette).not.toHaveBeenCalled()
    off()
    target.dispatchEvent(key('k', { ctrlKey: true }))
    expect(h.openPalette).not.toHaveBeenCalled()
  })

  it('命中时 preventDefault（避免浏览器/输入框默认行为）', () => {
    const off = bindGlobalHotkeys({}, target as never)
    const e = key('r', { ctrlKey: true })
    const spy = vi.spyOn(e, 'preventDefault')
    target.dispatchEvent(e)
    expect(spy).toHaveBeenCalled()
    off()
  })

  it('未提供 handler 的快捷键安全忽略', () => {
    const off = bindGlobalHotkeys({}, target as never)
    expect(() => target.dispatchEvent(key('n', { ctrlKey: true }))).not.toThrow()
    off()
  })

  it('长按重复事件（e.repeat）不连发（review 0.1.2）', () => {
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, target as never)
    target.dispatchEvent(key('r', { ctrlKey: true, repeat: true }))
    target.dispatchEvent(key('k', { ctrlKey: true, repeat: true }))
    target.dispatchEvent(key('1', { ctrlKey: true, repeat: true }))
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.openPalette).not.toHaveBeenCalled()
    expect(h.switchTab).not.toHaveBeenCalled()
    off()
  })

  it('Ctrl+Shift+, 不触发设置（shift 判定补全 — review 0.1.2）', () => {
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, target as never)
    target.dispatchEvent(key(',', { ctrlKey: true, shiftKey: true }))
    expect(h.openSettings).not.toHaveBeenCalled()
    target.dispatchEvent(key(',', { ctrlKey: true }))
    expect(h.openSettings).toHaveBeenCalledTimes(1)
    off()
  })
})

describe('HOTKEY_TABLE', () => {
  it('覆盖 §11.5 全部快捷键且带中文说明', () => {
    const ids = HOTKEY_TABLE.map((h) => h.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'palette',
        'newTerminal',
        'openSettings',
        'refresh',
        'toggleRawCommand',
        'switchTab',
      ]),
    )
    for (const h of HOTKEY_TABLE) {
      expect(h.label.length).toBeGreaterThan(0)
      expect(h.keys.length).toBeGreaterThan(0)
    }
  })
})

/** 带 closest 的事件目标模拟（unit 环境无 DOM）：matchers 命中任一选择器即视为「自身命中」 */
class FakeElement extends EventTarget {
  constructor(private readonly matchers: string[]) {
    super()
  }
  closest(sel: string): FakeElement | null {
    return this.matchers.some((m) => sel.includes(m)) ? this : null
  }
}

describe('输入上下文守卫（xterm/输入框内不劫持快捷键）', () => {
  const typingSelectors = ['input', 'textarea', 'select', '[contenteditable]']

  it.each(typingSelectors)('焦点在 %s 内时 Ctrl+K/N/R/1-9 全部放行给输入语境', (sel) => {
    const el = new FakeElement([sel])
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, el as never)
    el.dispatchEvent(key('k', { ctrlKey: true }))
    el.dispatchEvent(key('n', { ctrlKey: true }))
    el.dispatchEvent(key('r', { ctrlKey: true }))
    el.dispatchEvent(key('3', { ctrlKey: true }))
    expect(h.openPalette).not.toHaveBeenCalled()
    expect(h.newTerminal).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.switchTab).not.toHaveBeenCalled()
    off()
  })

  it('xterm 终端内（含 helper textarea）不被劫持', () => {
    const term = new FakeElement(['.xterm'])
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, term as never)
    term.dispatchEvent(key('k', { ctrlKey: true }))
    term.dispatchEvent(key('n', { ctrlKey: true }))
    term.dispatchEvent(key('5', { ctrlKey: true }))
    expect(h.openPalette).not.toHaveBeenCalled()
    expect(h.newTerminal).not.toHaveBeenCalled()
    expect(h.switchTab).not.toHaveBeenCalled()
    off()

    const helper = new FakeElement(['.xterm-helper-textarea'])
    const h2 = makeHandlers()
    const off2 = bindGlobalHotkeys(h2, helper as never)
    helper.dispatchEvent(key('r', { ctrlKey: true }))
    expect(h2.refresh).not.toHaveBeenCalled()
    off2()
  })

  it('非输入上下文仍正常触发（守卫不误伤）', () => {
    const el = new FakeElement([])
    const h = makeHandlers()
    const off = bindGlobalHotkeys(h, el as never)
    el.dispatchEvent(key('k', { ctrlKey: true }))
    el.dispatchEvent(key('2', { ctrlKey: true }))
    expect(h.openPalette).toHaveBeenCalledTimes(1)
    expect(h.switchTab).toHaveBeenCalledWith(1)
    off()
  })

  // ── 0.1.3：终端专属组合在输入/终端语境也放行（VS Code 集成终端同语义）──

  it('Ctrl+Shift+T / Ctrl+Tab / Ctrl+Shift+5/6 在 xterm 内也触发', () => {
    const h = {
      ...makeHandlers(),
      newTerminalTab: vi.fn(),
      nextTerminalTab: vi.fn(),
      prevTerminalTab: vi.fn(),
      splitTerminalRow: vi.fn(),
      splitTerminalCol: vi.fn(),
    }
    const el = new FakeElement(['.xterm'])
    const off = bindGlobalHotkeys(h, el as never)
    el.dispatchEvent(key('T', { ctrlKey: true, shiftKey: true, code: 'KeyT' }))
    el.dispatchEvent(key('Tab', { ctrlKey: true }))
    el.dispatchEvent(key('Tab', { ctrlKey: true, shiftKey: true }))
    el.dispatchEvent(key('%', { ctrlKey: true, shiftKey: true, code: 'Digit5' }))
    el.dispatchEvent(key('^', { ctrlKey: true, shiftKey: true, code: 'Digit6' }))
    expect(h.newTerminalTab).toHaveBeenCalledTimes(1)
    expect(h.nextTerminalTab).toHaveBeenCalledTimes(1)
    expect(h.prevTerminalTab).toHaveBeenCalledTimes(1)
    expect(h.splitTerminalRow).toHaveBeenCalledTimes(1)
    expect(h.splitTerminalCol).toHaveBeenCalledTimes(1)
    off()

    // 普通语境（非输入）同样工作；非 Shift 的 Ctrl+T 不误触
    const plain = new FakeElement([])
    const h2 = { ...makeHandlers(), newTerminalTab: vi.fn() }
    const off2 = bindGlobalHotkeys(h2, plain as never)
    plain.dispatchEvent(key('t', { ctrlKey: true }))
    expect(h2.newTerminalTab).not.toHaveBeenCalled()
    plain.dispatchEvent(key('T', { ctrlKey: true, shiftKey: true, code: 'KeyT' }))
    expect(h2.newTerminalTab).toHaveBeenCalledTimes(1)
    off2()
  })

  it('快捷键说明表包含 0.1.3 新增项（设置页展示唯一事实源）', () => {
    const ids = HOTKEY_TABLE.map((h) => h.id)
    for (const id of ['newTerminalTab', 'switchTabCycle', 'splitRow', 'splitCol']) {
      expect(ids).toContain(id)
    }
  })
})
