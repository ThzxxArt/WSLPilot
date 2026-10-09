import { describe, it, expect, afterEach } from 'vitest'

const { useCommandPalette } = await import('../../src/renderer/composables/useCommandPalette')

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
})
