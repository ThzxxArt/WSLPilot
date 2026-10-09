import { describe, it, expect, beforeEach, vi } from 'vitest'

const wslAPI = {
  terminal: {
    create: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    list: vi.fn(),
    maxSessions: vi.fn(async () => 3),
    onData: vi.fn(() => () => {}),
    onExit: vi.fn(() => () => {}),
  },
}
;(globalThis as any).window = { wslAPI }

const { useTerminalStore } = await import('../../src/renderer/stores/terminal')
const { createPinia, setActivePinia } = await import('pinia')

describe('useTerminalStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    wslAPI.terminal.maxSessions.mockResolvedValue(3)
    wslAPI.terminal.create.mockImplementation(async (o: any) => ({
      ptyId: `id-${Math.random().toString(16).slice(2)}`,
      distro: o.distro,
      shell: o.shell || '/bin/bash',
      createdAt: Date.now(),
    }))
    wslAPI.terminal.kill.mockResolvedValue(undefined)
  })

  it('open creates session and sets active', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const id = await s.open('Ubuntu')
    expect(id).toBeTruthy()
    expect(s.sessions).toHaveLength(1)
    expect(s.activeId).toBe(id)
    expect(s.active?.distro).toBe('Ubuntu')
    expect(wslAPI.terminal.create).toHaveBeenCalled()
  })

  it('respects maxSessions', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    await s.open('A')
    await s.open('B')
    await s.open('C')
    expect(s.aliveCount).toBe(3)
    const id = await s.open('D')
    expect(id).toBeNull()
    expect(s.lastError?.message).toContain('上限')
    expect(s.canCreate).toBe(false)
  })

  it('kill removes session and reassigns active', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const a = await s.open('A')
    const b = await s.open('B')
    await s.kill(a!)
    expect(s.sessions.map((x) => x.ptyId)).toEqual([b])
    expect(s.activeId).toBe(b)
  })

  it('rename / moveTab / appendOutput buffer cap', async () => {
    const s = useTerminalStore()
    const id = await s.open('U')
    s.rename(id!, '  我的标签  ')
    expect(s.sessions[0]!.title).toBe('我的标签')

    await s.open('V')
    s.moveTab(1, 0)
    expect(s.sessions[0]!.title).toBe('V') // 第二个挪到最前

    const big = 'x'.repeat(300 * 1024)
    s.appendOutput(s.sessions[0]!.ptyId, big)
    expect(s.sessions[0]!.buffer.length).toBeLessThanOrEqual(200 * 1024)
  })

  it('handleExit marks session dead', async () => {
    const s = useTerminalStore()
    const id = await s.open('U')
    s.handleExit(id!, 127)
    expect(s.active?.alive).toBe(false)
    expect(s.active?.exitCode).toBe(127)
    expect(s.aliveCount).toBe(0)
  })

  it('open surfaces AppError on failure', async () => {
    wslAPI.terminal.create.mockRejectedValue(
      new Error('WSLPILOT:{"code":"DISTRO_NOT_FOUND","message":"没有这个发行版","recoverable":true}'),
    )
    const s = useTerminalStore()
    const id = await s.open('Nope')
    expect(id).toBeNull()
    expect(s.lastError?.code).toBe('DISTRO_NOT_FOUND')
  })

  it('rename ignores blank title and clamps length', async () => {
    const s = useTerminalStore()
    const id = await s.open('U')
    s.rename(id!, '   ')
    expect(s.sessions[0]!.title).toBe('U')
    s.rename(id!, 'x'.repeat(200))
    expect(s.sessions[0]!.title.length).toBeLessThanOrEqual(80)
  })

  it('moveTab ignores out-of-range indices', async () => {
    const s = useTerminalStore()
    await s.open('A')
    const before = s.sessions.map((x) => x.title)
    s.moveTab(0, 5)
    s.moveTab(-1, 0)
    expect(s.sessions.map((x) => x.title)).toEqual(before)
    s.moveTab(0, 0)
    expect(s.sessions.map((x) => x.title)).toEqual(before)
  })

  it('appendOutput on unknown id is a no-op', () => {
    const s = useTerminalStore()
    expect(() => s.appendOutput('nope', 'x')).not.toThrow()
  })

  it('handleExit on unknown id is a no-op', () => {
    const s = useTerminalStore()
    expect(() => s.handleExit('nope', 1)).not.toThrow()
  })
})
