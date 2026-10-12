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

const { useTerminalStore, __terminalBuffersForTest } =
  await import('../../src/renderer/stores/terminal')
const { createPinia, setActivePinia } = await import('pinia')

describe('useTerminalStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // 模块级缓冲/孤儿记账必须逐用例隔离（否则前例数据污染后例 — review 假信心根治）
    __terminalBuffersForTest.reset()
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
    // IPC 参数契约：create 必须带 distro 与 cols/rows（默认 80×24，由 ipc-schema 约束）
    expect(wslAPI.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ distro: 'Ubuntu', cols: 80, rows: 24 }),
    )
  })

  it('open 拒绝未运行发行版：不建会话、给行动指引（review 启动只能走启动按钮）', async () => {
    const { useDistrosStore } = await import('../../src/renderer/stores/distros')
    const d = useDistrosStore()
    d.items = [
      {
        name: 'Stopped-one',
        state: 'Stopped',
        version: 2,
        isDefault: false,
        meta: null,
      } as never,
    ]
    const s = useTerminalStore()
    await s.loadLimits()
    const id = await s.open('Stopped-one')
    expect(id).toBeNull()
    expect(s.sessions).toHaveLength(0)
    expect(wslAPI.terminal.create).not.toHaveBeenCalled()
    expect(s.lastError?.code).toBe('DISTRO_NOT_RUNNING')
    expect(s.lastError?.suggestion).toContain('启动')

    // 运行中放行
    d.items = [
      { name: 'Run-one', state: 'Running', version: 2, isDefault: false, meta: null } as never,
    ]
    const ok = await s.open('Run-one')
    expect(ok).toBeTruthy()
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

  it('并发创建不同发行版不突破 maxSessions（TOCTOU 封死 — review 0.1.2 根治）', async () => {
    wslAPI.terminal.maxSessions.mockResolvedValue(1)
    let releaseCreate!: (v: unknown) => void
    wslAPI.terminal.create.mockReturnValueOnce(
      new Promise((r) => {
        releaseCreate = r
      }) as never,
    )
    const s = useTerminalStore()
    await s.loadLimits()
    // 第一次创建挂在 await 上；第二次并发调用时名额已被「创建中」占用
    const p1 = s.open('A')
    const p2 = s.open('B')
    expect(s.creatingDistros).toEqual(['A'])
    expect(await p2).toBeNull()
    expect(wslAPI.terminal.create).toHaveBeenCalledTimes(1)

    releaseCreate({ ptyId: 'id-a', distro: 'A', createdAt: 1 })
    expect(await p1).toBe('id-a')
    expect(s.sessions).toHaveLength(1)
    // 创建完成后名额释放，状态可继续创建（已被 alive 计数拦住）
    expect(s.creatingDistros).toEqual([])
    expect(s.canCreate).toBe(false)
  })

  it('同发行版并发创建去重：create 只调一次（review 0.1.2 根治）', async () => {
    let releaseCreate!: (v: unknown) => void
    wslAPI.terminal.create.mockReturnValueOnce(
      new Promise((r) => {
        releaseCreate = r
      }) as never,
    )
    const s = useTerminalStore()
    await s.loadLimits()
    const p1 = s.open('A')
    const p2 = s.open('A')
    // 第二个请求被 in-flight 集合拒绝（静默，不覆盖 lastError）
    expect(await p2).toBeNull()
    releaseCreate({ ptyId: 'id-a', distro: 'A', createdAt: 1 })
    expect(await p1).toBe('id-a')
    expect(wslAPI.terminal.create).toHaveBeenCalledTimes(1)
    expect(s.sessions).toHaveLength(1)
    expect(s.lastError).toBeNull()
    // 创建结束后同名发行版可再次打开（不是永久拒绝）
    expect(s.creatingDistros).toEqual([])
  })

  it('create 失败后释放「创建中」名额（不卡死后续打开）', async () => {
    wslAPI.terminal.create.mockRejectedValueOnce(new Error('ipc down'))
    const s = useTerminalStore()
    await s.loadLimits()
    expect(await s.open('A')).toBeNull()
    expect(s.creatingDistros).toEqual([])
    expect(s.lastError).toBeTruthy()
    // 失败后名额释放：下一次打开能真正再调 create
    wslAPI.terminal.create.mockResolvedValueOnce({ ptyId: 'id-b', distro: 'A', createdAt: 2 })
    expect(await s.open('A')).toBe('id-b')
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

  it('buffer 截断起点落在低位代理时跳过，不留孤立代理（review M1 真回归钉）', async () => {
    const s = useTerminalStore()
    const id = await s.open('U')
    const LIMIT = 200 * 1024
    // '😀' 占 2 个 UTF-16 单元；总长 LIMIT+1 → 截断起点 = 1（正落在低位代理上）
    s.appendOutput(id!, '😀' + 'x'.repeat(LIMIT - 1))
    const buf = s.getBuffer(id!)
    expect(buf.length).toBeLessThanOrEqual(LIMIT)
    const first = buf.charCodeAt(0)
    // 起点被修正：不得以孤立低位代理开头
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false)
    expect(buf.startsWith('x')).toBe(true)
  })

  it('buffer 截断起点落在高位代理时保留完整配对（不误删高代理）', async () => {
    const s = useTerminalStore()
    const id = await s.open('U')
    const LIMIT = 200 * 1024
    // 'a' + '😀' + x…；总长 LIMIT+1 → 截断起点 = 1（正落在高位代理上，低位在 slice 内）
    s.appendOutput(id!, 'a😀' + 'x'.repeat(LIMIT - 2))
    const buf = s.getBuffer(id!)
    const first = buf.charCodeAt(0)
    const second = buf.charCodeAt(1)
    expect(first >= 0xd800 && first <= 0xdbff).toBe(true)
    expect(second >= 0xdc00 && second <= 0xdfff).toBe(true)
    expect(buf.startsWith('😀')).toBe(true)
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

  it('孤儿缓冲限额淘汰真实发生（orphanCount 上限 + 最旧被移除），已收编会话不受影响', () => {
    const s = useTerminalStore()
    // 先收编一个"长寿"会话（插入序最旧）
    const kept = 'kept-session'
    s.adopt(kept, { distro: 'Ubuntu' })
    s.appendOutput(kept, 'precious')

    // 灌入超过上限的孤儿输出（从不 adopt）
    const orphanIds: string[] = []
    for (let i = 0; i < 24; i++) {
      const id = `orphan-${i}`
      orphanIds.push(id)
      s.appendOutput(id, 'x')
    }
    // 真淘汰：孤儿记账不超过上限，最旧 8 个被移除、最新保留
    expect(__terminalBuffersForTest.orphanCount()).toBeLessThanOrEqual(16)
    expect(__terminalBuffersForTest.has(orphanIds[0]!)).toBe(false)
    expect(__terminalBuffersForTest.has(orphanIds[7]!)).toBe(false)
    expect(__terminalBuffersForTest.has(orphanIds[23]!)).toBe(true)
    // 存活会话缓冲不被误删
    expect(s.getBuffer(kept)).toBe('precious')
  })

  it('孤儿退出事件暂存供 adopt 补终态；与输出共存', () => {
    const s = useTerminalStore()
    const id = `exit-${Math.random().toString(16).slice(2)}`
    s.appendOutput(id, 'before-exit')
    s.handleExit(id, 9)
    const session = s.adopt(id, { distro: 'U' })
    expect(session!.alive).toBe(false)
    expect(session!.exitCode).toBe(9)
    expect(s.getBuffer(id)).toBe('before-exit')
  })
})
