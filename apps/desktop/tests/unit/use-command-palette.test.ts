import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'

// node 环境无 window：注入最小事件目标（keydown 热键测试用）
const target = new EventTarget()
beforeAll(() => {
  ;(globalThis as any).window = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
})

function key(k: string, opts: { ctrlKey?: boolean; metaKey?: boolean } = {}): Event {
  const e = new Event('keydown', { cancelable: true }) as Event & Record<string, unknown>
  e.key = k
  e.ctrlKey = !!opts.ctrlKey
  e.metaKey = !!opts.metaKey
  return e
}

const { useCommandPalette, bindCommandPaletteHotkey } =
  await import('../../src/renderer/composables/useCommandPalette')

describe('useCommandPalette', () => {
  afterEach(() => {
    const { closePalette } = useCommandPalette()
    closePalette()
  })

  it('open / close / toggle 共享同一状态', () => {
    const a = useCommandPalette()
    const b = useCommandPalette()
    expect(a.open.value).toBe(false)
    a.openPalette()
    expect(b.open.value).toBe(true)
    b.togglePalette()
    expect(a.open.value).toBe(false)
    a.togglePalette()
    expect(a.open.value).toBe(true)
    a.closePalette()
    expect(a.open.value).toBe(false)
  })

  it('bindCommandPaletteHotkey 响应 Ctrl+K / Meta+K 并可解绑', () => {
    const { open } = useCommandPalette()
    const off = bindCommandPaletteHotkey()

    target.dispatchEvent(key('k', { ctrlKey: true }))
    expect(open.value).toBe(true)

    target.dispatchEvent(key('k', { ctrlKey: true }))
    expect(open.value).toBe(false)

    target.dispatchEvent(key('k', { metaKey: true }))
    expect(open.value).toBe(true)

    off()
    open.value = false
    target.dispatchEvent(key('k', { ctrlKey: true }))
    expect(open.value).toBe(false)
  })

  it('无关按键不触发', () => {
    const { open } = useCommandPalette()
    const off = bindCommandPaletteHotkey()
    target.dispatchEvent(key('j', { ctrlKey: true }))
    target.dispatchEvent(key('k'))
    expect(open.value).toBe(false)
    off()
    vi.restoreAllMocks()
  })
})
