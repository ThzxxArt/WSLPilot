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
  opts: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
): Event {
  const e = new Event('keydown', { cancelable: true }) as Event & Record<string, unknown>
  e.key = k
  e.ctrlKey = !!opts.ctrlKey
  e.metaKey = !!opts.metaKey
  e.shiftKey = !!opts.shiftKey
  e.altKey = !!opts.altKey
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
