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
    expect(s.getBuffer(s.sessions[0]!.ptyId).length).toBeLessThanOrEqual(200 * 1024)
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
      new Error(
        'WSLPILOT:{"code":"DISTRO_NOT_FOUND","message":"没有这个发行版","recoverable":true}',
      ),
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

  it('kill failure keeps session (review M5)', async () => {
    wslAPI.terminal.kill.mockRejectedValue(
      new Error('WSLPILOT:{"code":"TASK_FAILED","message":"kill 失败","recoverable":true}'),
    )
    const s = useTerminalStore()
    const id = await s.open('U')
    await expect(s.kill(id!)).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(s.sessions).toHaveLength(1)
    expect(s.sessions[0]!.alive).toBe(true)
  })

  it('buffer slice keeps surrogate pairs whole (review M1)', async () => {
    const s = useTerminalStore()
    const id = await s.open('U')
    // 🎉 = 2 UTF-16 units；灌超 200KB 触发截断
    s.appendOutput(id!, 'x'.repeat(200 * 1024 - 1))
    s.appendOutput(id!, '🎉') // 临界写入代理对
    s.appendOutput(id!, 'y'.repeat(100))
    const buf = s.getBuffer(id!)
    expect(buf.length).toBeLessThanOrEqual(200 * 1024)
    // 截断后开头不得是孤立高代理
    const c = buf.charCodeAt(0)
    expect(c < 0xd800 || c > 0xdbff).toBe(true)
  })

  it('buffer 移出响应式系统：getBuffer 读取，removeLocal 清理', async () => {
    const s = useTerminalStore()
    const id = await s.open('U')
    s.appendOutput(id!, 'hello')
    expect(s.getBuffer(id!)).toBe('hello')
    s.removeLocal(id!)
    expect(s.getBuffer(id!)).toBe('')
    // 未知 id 有缓冲防护
    expect(s.getBuffer('missing')).toBe('')
  })

  // ── M5 收编与竞态（review 根治）──

  it('adopt 收编已存在会话并保留 adopt 前到达的输出', () => {
    const s = useTerminalStore()
    const ptyId = `race-${Math.random().toString(16).slice(2)}`
    // 数据先于 adopt 到达（竞态窗口）
    s.appendOutput(ptyId, 'early-output')
    s.appendOutput(ptyId, '-more')
    const session = s.adopt(ptyId, { title: '动作', distro: 'Ubuntu' })
    expect(session).not.toBeNull()
    expect(s.sessions).toHaveLength(1)
    expect(s.sessions[0]).toMatchObject({ ptyId, title: '动作', distro: 'Ubuntu', alive: true })
    expect(s.getBuffer(ptyId)).toBe('early-output-more')
    // 重复 adopt 幂等
    expect(s.adopt(ptyId, { title: 'x', distro: 'y' })).not.toBeNull()
    expect(s.sessions).toHaveLength(1)
  })

  it('adopt 前已退出的会话直接标终态（竞态防护）', () => {
    const s = useTerminalStore()
    const ptyId = `dead-${Math.random().toString(16).slice(2)}`
    s.handleExit(ptyId, 42) // 退出事件先到，会话尚不存在
    const session = s.adopt(ptyId, { distro: 'Ubuntu' })
    expect(session!.alive).toBe(false)
    expect(session!.exitCode).toBe(42)
    // title 缺省回落 distro
    expect(session!.title).toBe('Ubuntu')
  })

  it('recover 收编主进程存活会话；list 失败静默', async () => {
    const s = useTerminalStore()
    wslAPI.terminal.list.mockResolvedValueOnce([
      { ptyId: 'orphan-1', distro: 'Debian', shell: '/bin/sh', createdAt: 1 },
    ])
    await s.recover()
    expect(s.sessions).toHaveLength(1)
    expect(s.sessions[0]).toMatchObject({ ptyId: 'orphan-1', distro: 'Debian' })

    wslAPI.terminal.list.mockRejectedValueOnce(new Error('ipc down'))
    await expect(s.recover()).resolves.toBeUndefined()
  })
})
