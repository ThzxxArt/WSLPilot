import { describe, it, expect, beforeEach, vi } from 'vitest'

const wslAPI = {
  io: {
    export: vi.fn(),
    import: vi.fn(),
    move: vi.fn(),
    listBackups: vi.fn(async () => []),
    cleanupBackups: vi.fn(async () => ({ removed: 0 })),
  },
  distros: {
    install: vi.fn(async () => ({ taskId: 'ins-1' })),
    list: vi.fn(async () => []),
  },
  task: {
    cancel: vi.fn(async () => true),
    onProgress: vi.fn(() => () => {}),
  },
  app: {
    pickDirectory: vi.fn(async () => null),
    pickSaveFile: vi.fn(async () => null),
    pickOpenFile: vi.fn(async () => null),
    openPath: vi.fn(async () => {}),
  },
}
;(globalThis as any).window = { wslAPI }

const { useTasksStore, MAX_TASK_LOGS } = await import('../../src/renderer/stores/tasks')
const { createPinia, setActivePinia } = await import('pinia')

describe('useTasksStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('startExport tracks handle and receives progress events', async () => {
    wslAPI.io.export.mockResolvedValue({ taskId: 't1' })
    const s = useTasksStore()
    const entry = await s.startExport({ name: 'Ubuntu', path: 'C:\\b\\u.tar', format: 'tar' })
    expect(entry?.taskId).toBe('t1')
    expect(entry?.type).toBe('export')
    expect(entry?.status).toBe('running')

    s.applyProgress({
      taskId: 't1',
      type: 'export',
      distro: 'Ubuntu',
      percent: 42,
      message: '导出中',
      status: 'running',
      logLine: 'hello',
    })
    const t = s.byId('t1')
    expect(t?.percent).toBe(42)
    expect(t?.logs).toEqual(['hello'])

    s.applyProgress({
      taskId: 't1',
      type: 'export',
      percent: 100,
      message: '导出完成',
      status: 'success',
    })
    expect(s.byId('t1')?.status).toBe('success')
    expect(s.runningCount).toBe(0)
  })

  it('startImport / startMove track entries', async () => {
    wslAPI.io.import.mockResolvedValue({ taskId: 'i1' })
    wslAPI.io.move.mockResolvedValue({ taskId: 'm1' })
    const s = useTasksStore()
    const i = await s.startImport({
      name: 'New',
      installPath: 'D:\\x',
      archivePath: 'D:\\a.tar',
      format: 'tar',
      version: 2,
      inPlace: false,
    })
    expect(i?.taskId).toBe('i1')
    const m = await s.startMove({ name: 'U', path: 'D:\\U', terminateFirst: true })
    expect(m?.taskId).toBe('m1')
    expect(s.runningCount).toBe(2)
  })

  it('captures AppError when invoke rejects', async () => {
    wslAPI.io.export.mockRejectedValue(
      new Error('WSLPILOT:{"code":"IO_ERROR","message":"路径不能为空","recoverable":true}'),
    )
    const s = useTasksStore()
    const entry = await s.startExport({ name: 'U', path: '', format: 'tar' })
    expect(entry).toBeNull()
    expect(s.lastError?.code).toBe('IO_ERROR')
  })

  it('cancel forwards to API and captures errors', async () => {
    const s = useTasksStore()
    await s.cancel('t1')
    expect(wslAPI.task.cancel).toHaveBeenCalledWith('t1')

    wslAPI.task.cancel.mockRejectedValueOnce(new Error('boom'))
    await expect(s.cancel('t2')).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(s.lastError?.message).toBeTruthy()
  })

  it('failed and canceled statuses record error text', async () => {
    const s = useTasksStore()
    s.track({ taskId: 'a' }, { type: 'export', distro: 'U', message: 'm' })
    s.applyProgress({
      taskId: 'a',
      type: 'export',
      percent: null,
      message: '炸了',
      status: 'failed',
    })
    expect(s.byId('a')?.status).toBe('failed')
    expect(s.byId('a')?.error).toBe('炸了')

    s.track({ taskId: 'b' }, { type: 'export', message: 'm' })
    s.applyProgress({
      taskId: 'b',
      type: 'export',
      percent: null,
      message: '已取消',
      status: 'canceled',
    })
    expect(s.byId('b')?.error).toBe('任务已取消')
  })

  it('caps log lines at MAX_TASK_LOGS', () => {
    const s = useTasksStore()
    s.track({ taskId: 'log' }, { type: 'export', message: 'm' })
    for (let i = 0; i < MAX_TASK_LOGS + 10; i++) {
      s.applyProgress({
        taskId: 'log',
        type: 'export',
        percent: 0,
        message: 'm',
        status: 'running',
        logLine: `l${i}`,
      })
    }
    expect(s.byId('log')?.logs.length).toBe(MAX_TASK_LOGS)
  })

  it('clearFinished keeps running tasks only', async () => {
    wslAPI.io.export.mockResolvedValue({ taskId: 'r1' })
    const s = useTasksStore()
    await s.startExport({ name: 'U', path: 'p', format: 'tar' })
    s.track({ taskId: 'done1' }, { type: 'export', message: 'm' })
    s.applyProgress({
      taskId: 'done1',
      type: 'export',
      percent: 100,
      message: 'ok',
      status: 'success',
    })
    s.clearFinished()
    expect(s.entries.map((e) => e.taskId)).toEqual(['r1'])
  })

  it('ignores malformed progress payloads', () => {
    const s = useTasksStore()
    s.applyProgress(null as never)
    s.applyProgress({} as never)
    expect(s.entries).toHaveLength(0)
    // track 幂等：同 id 不重复建
    s.track({ taskId: 'x' }, { type: 'export', message: 'a' })
    s.track({ taskId: 'x' }, { type: 'export', message: 'b' })
    expect(s.entries).toHaveLength(1)
  })

  it('startInstall tracks install task', async () => {
    wslAPI.distros.install = vi.fn(async () => ({ taskId: 'ins-1' }))
    const s = useTasksStore()
    const entry = await s.startInstall('Ubuntu')
    expect(entry?.taskId).toBe('ins-1')
    expect(entry?.type).toBe('install')
    const entry2 = await s.startInstall()
    expect(wslAPI.distros.install).toHaveBeenCalledWith(undefined)
    void entry2
  })

  it('startInstall 捕获 invoke 错误', async () => {
    wslAPI.distros.install = vi.fn(async () => {
      throw new Error('WSLPILOT:{"code":"TASK_FAILED","message":"安装失败","recoverable":true}')
    })
    const s = useTasksStore()
    expect(await s.startInstall('X')).toBeNull()
    expect(s.lastError?.message).toBe('安装失败')
  })

  it('trimFinished 保留最近 10 条终态记录（review M7）', () => {
    const s = useTasksStore()
    for (let i = 0; i < 12; i++) {
      s.track({ taskId: `f${i}` }, { type: 'export', message: `m${i}` })
      s.applyProgress({
        taskId: `f${i}`,
        type: 'export',
        percent: 100,
        message: 'ok',
        status: 'success',
      })
    }
    s.track({ taskId: 'running-1' }, { type: 'move', message: 'run' })
    expect(s.entries.filter((e) => e.status !== 'running').length).toBe(10)
    expect(s.entries.some((e) => e.taskId === 'running-1')).toBe(true)
    expect(s.entries.some((e) => e.taskId === 'f0')).toBe(false)
    expect(s.entries.some((e) => e.taskId === 'f11')).toBe(true)
  })
})
