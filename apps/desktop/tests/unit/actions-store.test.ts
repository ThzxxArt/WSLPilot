import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WslAction } from '@wslpilot/shared'

const wslAPI = {
  actions: {
    list: vi.fn(),
    save: vi.fn(),
    run: vi.fn(),
  },
  terminal: {
    create: vi.fn(),
    kill: vi.fn(),
    list: vi.fn(async () => []),
    maxSessions: vi.fn(async () => 10),
  },
}
;(globalThis as any).window = { wslAPI, confirm: vi.fn(() => true) }

const { useActionsStore } = await import('../../src/renderer/stores/actions')
const { useTerminalStore } = await import('../../src/renderer/stores/terminal')
const { createPinia, setActivePinia } = await import('pinia')

const A1: WslAction = {
  id: 'a1',
  label: '动作一',
  scope: 'distro',
  program: '/bin/true',
  args: [],
  terminal: false,
  confirm: true,
}

const A2: WslAction = {
  id: 'a2',
  label: '动作二',
  scope: 'global',
  program: '/bin/echo',
  args: ['hi'],
  terminal: true,
  confirm: false,
}

describe('useActionsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load 读取动作清单', async () => {
    wslAPI.actions.list.mockResolvedValue([A1, A2])
    const s = useActionsStore()
    await s.load()
    expect(s.items).toHaveLength(2)
    expect(s.items.find((a) => a.id === 'a1')?.label).toBe('动作一')
    expect(s.items.some((a) => a.id === 'nope')).toBe(false)
    expect(s.loaded).toBe(true)
  })

  it('load 失败记录 AppError；非数组降级为空', async () => {
    wslAPI.actions.list.mockRejectedValue({ code: 'IO_ERROR', message: 'x', recoverable: true })
    const s = useActionsStore()
    await s.load()
    expect(s.lastError?.code).toBe('IO_ERROR')

    wslAPI.actions.list.mockResolvedValue(null)
    const s2 = useActionsStore()
    await s2.load()
    expect(s2.items).toEqual([])
  })

  it('upsert 新增与更新', async () => {
    wslAPI.actions.save.mockResolvedValue({})
    const s = useActionsStore()
    await s.upsert(A1)
    expect(s.items).toHaveLength(1)
    await s.upsert({ ...A1, label: '改名' })
    expect(s.items).toHaveLength(1)
    expect(s.items[0]!.label).toBe('改名')
    expect(wslAPI.actions.save).toHaveBeenCalledTimes(2)
  })

  it('persist 失败抛出并回滚本地状态', async () => {
    wslAPI.actions.save.mockRejectedValue({ code: 'IO_ERROR', message: 'no', recoverable: true })
    const s = useActionsStore()
    await expect(s.upsert(A1)).rejects.toMatchObject({ code: 'IO_ERROR' })
    expect(s.items).toHaveLength(0)
    expect(s.saving).toBe(false)
  })

  it('remove 暂存删除，undoRestore 恢复', async () => {
    wslAPI.actions.save.mockResolvedValue({})
    const s = useActionsStore()
    await s.upsert(A1)
    await s.remove('a1')
    expect(s.items).toHaveLength(0)
    expect(s.lastRemoved?.id).toBe('a1')
    await s.undoRestore()
    expect(s.items).toHaveLength(1)
    expect(s.lastRemoved).toBeNull()
  })

  it('并发 upsert 不丢更新（写队列 — review 0.1.2 根治）', async () => {
    let releaseFirst!: () => void
    wslAPI.actions.save
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            releaseFirst = r
          }),
      )
      .mockResolvedValue({})
    const s = useActionsStore()
    const p1 = s.upsert(A1)
    const p2 = s.upsert(A2)
    await new Promise((r) => setTimeout(r, 0))
    expect(wslAPI.actions.save).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([p1, p2])
    // 第二次写入基于第一次的结果：两条都在，而不是后者覆盖前者
    expect(s.items.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
    expect(wslAPI.actions.save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'a1' }),
      expect.objectContaining({ id: 'a2' }),
    ])
  })

  it('remove 返回被删对象；连续删除后各自撤销恢复各自（review 0.1.2 根治）', async () => {
    wslAPI.actions.save.mockResolvedValue({})
    const s = useActionsStore()
    await s.upsert(A1)
    await s.upsert(A2)
    const r1 = await s.remove('a1')
    const r2 = await s.remove('a2')
    expect(r1?.id).toBe('a1')
    expect(r2?.id).toBe('a2')
    expect(s.lastRemoved?.id).toBe('a2')
    // 点 A 的撤销：恢复 A，不误清 B 的撤销缓冲
    await s.undoRestore(r1!)
    expect(s.items.map((a) => a.id)).toEqual(['a1'])
    expect(s.lastRemoved?.id).toBe('a2')
    await s.undoRestore(r2!)
    expect(s.items.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
    expect(s.lastRemoved).toBeNull()
  })

  it('remove 不存在的 id 无副作用；undoRestore 空操作', async () => {
    const s = useActionsStore()
    await s.remove('nope')
    expect(wslAPI.actions.save).not.toHaveBeenCalled()
    await s.undoRestore()
    expect(s.items).toHaveLength(0)
  })

  it('run 返回 handle；terminal 动作收编会话到终端仓', async () => {
    wslAPI.actions.run.mockResolvedValue({ taskId: 't1', ptyId: 'p1', distro: 'Ubuntu' })
    const s = useActionsStore()
    s.items = [A2]
    const terminal = useTerminalStore()
    const handle = await s.run('a2', 'Ubuntu')
    expect(handle.ptyId).toBe('p1')
    expect(terminal.sessions).toHaveLength(1)
    expect(terminal.sessions[0]).toMatchObject({ ptyId: 'p1', title: '动作二', distro: 'Ubuntu' })
  })

  it('run 非 terminal 动作不收编；失败抛 AppError', async () => {
    wslAPI.actions.run.mockResolvedValue({ taskId: 't2' })
    const s = useActionsStore()
    s.items = [A1]
    const terminal = useTerminalStore()
    await s.run('a1', 'Ubuntu')
    expect(terminal.sessions).toHaveLength(0)

    wslAPI.actions.run.mockRejectedValue({ code: 'TASK_FAILED', message: 'x', recoverable: true })
    await expect(s.run('a1')).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(s.lastError?.code).toBe('TASK_FAILED')
  })
})
