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
  config: {
    get: vi.fn(async () => ({ terminalLayout: [] })),
    set: vi.fn(async () => ({})),
  },
}
;(globalThis as any).window = { wslAPI }

const { useTerminalStore, __terminalBuffersForTest } =
  await import('../../src/renderer/stores/terminal')
const { useDistrosStore } = await import('../../src/renderer/stores/distros')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const { createPinia, setActivePinia } = await import('pinia')

let seq = 0
function freshId(prefix = 'id') {
  seq++
  return `${prefix}-${seq}`
}

function runningDistro(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    state: 'Running' as const,
    version: 2 as const,
    isDefault: false,
    meta: {
      name,
      alias: '',
      tags: [],
      color: '',
      icon: 'linux',
      note: '',
      startupCwd: '~',
      pinned: false,
      quickActions: [],
    },
    ...over,
  }
}

describe('useTerminalStore（0.1.3 tabs + panes 模型）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // 模块级缓冲/孤儿记账必须逐用例隔离（否则前例数据污染后例 — review 假信心根治）
    __terminalBuffersForTest.reset()
    wslAPI.terminal.maxSessions.mockResolvedValue(10)
    wslAPI.config.get.mockResolvedValue({ terminalLayout: [] })
    wslAPI.terminal.create.mockImplementation(async (o: any) => ({
      ptyId: freshId(),
      distro: o.distro,
      shell: o.shell || '/bin/bash',
      cwd: o.cwd,
      createdAt: Date.now(),
    }))
    wslAPI.terminal.kill.mockResolvedValue(undefined)
  })

  it('open 创建标签 + 面板并设为活动', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const id = await s.open('Ubuntu')
    expect(id).toBeTruthy()
    expect(s.tabs).toHaveLength(1)
    expect(s.panes[id!]).toMatchObject({ distro: 'Ubuntu', alive: true })
    expect(s.activeId).toBe(id)
    expect(s.activeTabId).toBe(s.tabs[0]!.id)
    // IPC 参数契约：create 必须带 distro 与 cols/rows（默认 80×24，由 ipc-schema 约束）
    expect(wslAPI.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ distro: 'Ubuntu', cols: 80, rows: 24 }),
    )
  })

  it('openDefault 接线 startupCwd 与默认 Shell（0.1.3 半幽灵字段根治）', async () => {
    useDistrosStore().items = [
      runningDistro('Ubuntu', {
        meta: { ...runningDistro('Ubuntu').meta, startupCwd: '/home/me/project' },
      }) as never,
    ]
    useSettingsStore().wslDefaultShell = '/bin/zsh'
    const s = useTerminalStore()
    const id = await s.openDefault('Ubuntu')
    expect(id).toBeTruthy()
    expect(wslAPI.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ distro: 'Ubuntu', shell: '/bin/zsh', cwd: '/home/me/project' }),
    )
    expect(s.panes[id!]).toMatchObject({ shell: '/bin/zsh', cwd: '/home/me/project' })
  })

  it('openDefault：startupCwd 为 ~ 时不传 cwd（由发行版默认处理）', async () => {
    useDistrosStore().items = [runningDistro('Ubuntu') as never]
    const s = useTerminalStore()
    await s.openDefault('Ubuntu')
    const arg = wslAPI.terminal.create.mock.calls[0]![0]
    expect(arg.cwd).toBeUndefined()
  })

  it('open 拒绝未运行发行版：不建会话、给行动指引（review 启动只能走启动按钮）', async () => {
    const d = useDistrosStore()
    d.items = [{ ...runningDistro('Stopped-one'), state: 'Stopped' } as never]
    const s = useTerminalStore()
    await s.loadLimits()
    const id = await s.open('Stopped-one')
    expect(id).toBeNull()
    expect(s.tabs).toHaveLength(0)
    expect(wslAPI.terminal.create).not.toHaveBeenCalled()
    expect(s.lastError?.code).toBe('DISTRO_NOT_RUNNING')
    expect(s.lastError?.suggestion).toContain('启动')

    // 运行中放行
    d.items = [runningDistro('Run-one') as never]
    const ok = await s.open('Run-one')
    expect(ok).toBeTruthy()
    expect(wslAPI.terminal.create).toHaveBeenCalled()
  })

  it('respects maxSessions（存活面板计数）', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    wslAPI.terminal.maxSessions.mockResolvedValue(3)
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
    expect(s.tabs).toHaveLength(1)
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
    expect(s.tabs).toHaveLength(1)
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

  it('同发行版大小写变体并发去重：Ubuntu/ubuntu 同一发行版（review 0.1.2 审计修复）', async () => {
    let releaseCreate!: (v: unknown) => void
    wslAPI.terminal.create.mockReturnValueOnce(
      new Promise((r) => {
        releaseCreate = r
      }) as never,
    )
    const s = useTerminalStore()
    await s.loadLimits()
    const p1 = s.open('Ubuntu')
    const p2 = s.open('ubuntu')
    expect(await p2).toBeNull()
    expect(wslAPI.terminal.create).toHaveBeenCalledTimes(1)
    releaseCreate({ ptyId: 'id-u', distro: 'Ubuntu', createdAt: 1 })
    expect(await p1).toBe('id-u')
    expect(s.tabs).toHaveLength(1)
    // 名额正常释放（大小写归一的清理不误留）
    expect(s.creatingDistros).toEqual([])
  })

  // ── 0.1.3 分屏 ──

  it('splitPane：同发行版/同 shell/同目录新建面板并更新布局树', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const first = (await s.open('Ubuntu', { shell: '/bin/bash', cwd: '/work' }))!
    const second = await s.splitPane(first, 'row')
    expect(second).toBeTruthy()
    expect(wslAPI.terminal.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ distro: 'Ubuntu', shell: '/bin/bash', cwd: '/work' }),
    )
    const tab = s.tabs[0]!
    expect(tab.layout).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: { kind: 'leaf', ptyId: first },
      b: { kind: 'leaf', ptyId: second },
    })
    expect(s.activeId).toBe(second)
  })

  it('单标签面板上限 4：第 5 个面板拒绝并给指引', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    // UI 双保险配套 getter：无标签不可分屏
    expect(s.canSplit).toBe(false)
    const first = (await s.open('Ubuntu'))!
    expect(s.canSplit, '单面板可继续分屏').toBe(true)
    const p2 = (await s.splitPane(first, 'row'))!
    const p3 = (await s.splitPane(p2, 'col'))!
    expect(s.canSplit, '3 面板仍可到 4').toBe(true)
    const p4 = (await s.splitPane(p3, 'row'))!
    expect(p4).toBeTruthy()
    const p5 = await s.splitPane(p4, 'row')
    expect(p5).toBeNull()
    expect(s.lastError?.message).toContain('最多 4 个面板')
    expect(s.canSplit, '达到 4 面板上限后 UI 入口同步禁用').toBe(false)
    // 拒绝时不得残留半成品 pty（会话数不变）
    expect(Object.keys(s.panes)).toHaveLength(4)
  })

  it('closePane：kill + 折叠父 split + 活动回退；最后一个面板移除标签', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const first = (await s.open('Ubuntu'))!
    const second = (await s.splitPane(first, 'row'))!
    // 关闭第二个面板：布局折叠回单叶
    await s.closePane(second)
    expect(wslAPI.terminal.kill).toHaveBeenCalledWith(second)
    expect(s.tabs[0]!.layout).toEqual({ kind: 'leaf', ptyId: first })
    expect(s.activeId).toBe(first)

    // 关闭最后一个面板：标签移除
    await s.closePane(first)
    expect(s.tabs).toHaveLength(0)
    expect(s.activeId).toBe('')
    expect(s.activeTabId).toBe('')
  })

  it('closePane kill 失败：面板保留并抛错（不静默丢会话 — review M5 语义保持）', async () => {
    wslAPI.terminal.kill.mockRejectedValueOnce(
      new Error('WSLPILOT:{"code":"TASK_FAILED","message":"kill 失败","recoverable":true}'),
    )
    const s = useTerminalStore()
    await s.loadLimits()
    const id = (await s.open('U'))!
    await expect(s.closePane(id)).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(s.panes[id]).toBeTruthy()
    expect(s.tabs).toHaveLength(1)
  })

  it('closeTab：kill 全部面板 + 移除标签 + 活动标签回退', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const a = (await s.open('A'))!
    await s.splitPane(a, 'col')
    const b = await s.open('B')
    expect(s.tabs).toHaveLength(2)
    await s.closeTab(s.tabs[0]!.id)
    expect(wslAPI.terminal.kill).toHaveBeenCalledTimes(2)
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0]!.id).toBe(b)
    expect(s.activeTabId).toBe(b)
    expect(s.activeId).toBe(b)
  })

  it('setRatio 更新比例并夹取到 [0.15, 0.85]', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const first = (await s.open('U'))!
    await s.splitPane(first, 'row')
    const tabId = s.tabs[0]!.id
    s.setRatio(tabId, [], 0.3)
    expect((s.tabs[0]!.layout as { ratio: number }).ratio).toBeCloseTo(0.3)
    s.setRatio(tabId, [], 0.99)
    expect((s.tabs[0]!.layout as { ratio: number }).ratio).toBe(0.85)
    s.setRatio(tabId, [], -1)
    expect((s.tabs[0]!.layout as { ratio: number }).ratio).toBe(0.15)
  })

  it('setActiveTab 保留该标签内活动面板；跨标签回退首面板', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const a = (await s.open('A'))!
    const a2 = (await s.splitPane(a, 'row'))!
    const b = (await s.open('B'))!
    // 回到标签 A：活动面板仍是 a2
    s.setActiveTab(s.tabs[0]!.id)
    expect(s.activeId).toBe(a2)
    // 去标签 B：活动切成 B
    s.setActiveTab(s.tabs[1]!.id)
    expect(s.activeId).toBe(b)
  })

  it('rename / moveTab / appendOutput buffer cap', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    await s.open('U')
    s.rename(s.tabs[0]!.id, '  我的标签  ')
    expect(s.tabs[0]!.title).toBe('我的标签')

    await s.open('V')
    s.moveTab(1, 0)
    expect(s.tabs[0]!.title).toBe('V') // 第二个挪到最前

    const big = 'x'.repeat(300 * 1024)
    s.appendOutput(Object.keys(s.panes)[0]!, big)
    expect(s.getBuffer(Object.keys(s.panes)[0]!).length).toBeLessThanOrEqual(200 * 1024)
  })

  it('handleExit marks pane dead（标签存活判定随面板）', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const id = (await s.open('U'))!
    s.handleExit(id, 127)
    expect(s.panes[id]!.alive).toBe(false)
    expect(s.panes[id]!.exitCode).toBe(127)
    expect(s.aliveCount).toBe(0)
    expect(s.tabAlive(s.tabs[0]!.id)).toBe(false)

    // 分屏中一面板退出，标签仍存活
    const first = (await s.open('X'))!
    const second = (await s.splitPane(first, 'row'))!
    s.handleExit(second, 0)
    expect(s.tabAlive(s.tabs[1]!.id)).toBe(true)
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
    const tabId = s.tabs[0]!.id
    s.rename(tabId, '   ')
    expect(s.tabs[0]!.title).toBe('U')
    s.rename(tabId, 'x'.repeat(200))
    expect(s.tabs[0]!.title.length).toBeLessThanOrEqual(80)
    expect(id).toBeTruthy()
  })

  it('moveTab ignores out-of-range indices', async () => {
    const s = useTerminalStore()
    await s.open('A')
    await s.open('B')
    const before = s.tabs.map((t) => t.title)
    s.moveTab(0, 5)
    s.moveTab(-1, 0)
    expect(s.tabs.map((t) => t.title)).toEqual(before)
    s.moveTab(0, 0)
    expect(s.tabs.map((t) => t.title)).toEqual(before)
  })

  it('appendOutput on unknown id is a no-op', () => {
    const s = useTerminalStore()
    expect(() => s.appendOutput('nope', 'x')).not.toThrow()
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

  it('buffer 移出响应式系统：getBuffer 读取，closePane 清理', async () => {
    const s = useTerminalStore()
    const id = await s.open('U')
    s.appendOutput(id!, 'hello')
    expect(s.getBuffer(id!)).toBe('hello')
    await s.closePane(id!)
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
    const meta = s.adopt(ptyId, { title: '动作', distro: 'Ubuntu' })
    expect(meta).not.toBeNull()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0]).toMatchObject({ id: ptyId, title: '动作' })
    expect(s.panes[ptyId]).toMatchObject({ distro: 'Ubuntu', alive: true })
    expect(s.getBuffer(ptyId)).toBe('early-output-more')
    // 重复 adopt 幂等
    expect(s.adopt(ptyId, { title: 'x', distro: 'y' })).not.toBeNull()
    expect(s.tabs).toHaveLength(1)
  })

  it('adopt 前已退出的会话直接标终态（竞态防护）', () => {
    const s = useTerminalStore()
    const ptyId = `dead-${Math.random().toString(16).slice(2)}`
    s.handleExit(ptyId, 42) // 退出事件先到，会话尚不存在
    const meta = s.adopt(ptyId, { distro: 'Ubuntu' })
    expect(meta!.alive).toBe(false)
    expect(meta!.exitCode).toBe(42)
    // title 缺省回落 distro
    expect(s.tabs[0]!.title).toBe('Ubuntu')
  })

  it('recover 收编主进程存活会话；list 失败静默', async () => {
    const s = useTerminalStore()
    wslAPI.terminal.list.mockResolvedValueOnce([
      { ptyId: 'orphan-1', distro: 'Debian', shell: '/bin/sh', createdAt: 1 },
    ])
    await s.recover()
    expect(s.tabs).toHaveLength(1)
    expect(s.panes['orphan-1']).toMatchObject({ distro: 'Debian' })
    // 0.1.3：恢复使用主进程会话的真实创建时间（不是恢复时刻）
    expect(s.panes['orphan-1']!.createdAt).toBe(1)
    expect(s.activeId).toBe('orphan-1')

    wslAPI.terminal.list.mockRejectedValueOnce(new Error('ipc down'))
    await expect(s.recover()).resolves.toBeUndefined()
  })

  it('recover 按 ui-state.terminalLayout 恢复分屏：死面板剪枝 + 折叠单子 split（0.1.3）', async () => {
    wslAPI.terminal.list.mockResolvedValueOnce([
      { ptyId: 'p1', distro: 'Ubuntu', shell: '/bin/bash', createdAt: 1 },
      { ptyId: 'p2', distro: 'Ubuntu', shell: '/bin/bash', createdAt: 2 },
      { ptyId: 'p9', distro: 'Debian', shell: '/bin/bash', createdAt: 9 },
    ])
    wslAPI.config.get.mockResolvedValueOnce({
      terminalLayout: [
        {
          id: 't1',
          title: '分屏标签',
          layout: {
            kind: 'split',
            dir: 'row',
            ratio: 0.4,
            a: { kind: 'leaf', ptyId: 'p1' },
            b: {
              kind: 'split',
              dir: 'col',
              ratio: 0.5,
              // p7 已死（不在 list 中）：应被剪枝并折叠父 split
              a: { kind: 'leaf', ptyId: 'p7' },
              b: { kind: 'leaf', ptyId: 'p2' },
            },
          },
        },
      ],
    } as never)
    const s = useTerminalStore()
    await s.recover()
    // 恢复出两个标签：分屏标签（p1+p2）与被布局遗漏的 p9
    expect(s.tabs).toHaveLength(2)
    const restored = s.tabs.find((t) => t.title === '分屏标签')!
    expect(restored.layout).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: 0.4,
      a: { kind: 'leaf', ptyId: 'p1' },
      b: { kind: 'leaf', ptyId: 'p2' },
    })
    expect(Object.keys(s.panes).sort()).toEqual(['p1', 'p2', 'p9'])
    expect(s.activeId).toBeTruthy()
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

  it('布局变更防抖持久化到 ui-state.terminalLayout（0.1.3）', async () => {
    vi.useFakeTimers()
    try {
      const s = useTerminalStore()
      await s.open('U')
      // open 触发的持久化在防抖窗口内未写盘
      expect(wslAPI.config.set).not.toHaveBeenCalled()
      vi.advanceTimersByTime(600)
      expect(wslAPI.config.set).toHaveBeenCalledTimes(1)
      const call = (wslAPI.config.set.mock.calls as unknown[][])[0]!
      expect(call[0]).toBe('uiState')
      const patch = call[1] as { terminalLayout: Array<{ layout: { kind: string } }> }
      expect(patch.terminalLayout).toHaveLength(1)
      expect(patch.terminalLayout[0]!.layout.kind).toBe('leaf')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reassignActive 自愈：活动指针指向不存在面板时回退', async () => {
    const s = useTerminalStore()
    await s.loadLimits()
    const a = (await s.open('A'))!
    await s.open('B')
    s.activeId = 'ghost'
    s.reassignActive()
    const tab = s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0]!
    expect(s.activeId === a || s.panes[s.activeId]).toBeTruthy()
    expect(s.panes[s.activeId]).toBeTruthy()
    expect(tab).toBeTruthy()
  })
})
