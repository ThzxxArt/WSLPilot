import { describe, it, expect, beforeEach, vi } from 'vitest'

const wslAPI = {
  io: {
    clone: vi.fn(async () => ({ taskId: 'cl-1' })),
    export: vi.fn(),
    import: vi.fn(),
    move: vi.fn(),
    listBackups: vi.fn(async () => []),
    cleanupBackups: vi.fn(async () => ({ removed: 0 })),
  },
  distros: {
    install: vi.fn(async () => ({ taskId: 'ins-1' })),
    setVersion: vi.fn(async () => ({ taskId: 'cv-1' })),
    setSparse: vi.fn(async () => ({ taskId: 'sp-1' })),
    compact: vi.fn(async () => ({ taskId: 'cp-1' })),
    resize: vi.fn(async () => ({ taskId: 'rs-1' })),
    setDefaultUser: vi.fn(async () => ({ taskId: 'du-1' })),
    unregister: vi.fn(async () => ({ taskId: 'un-1' })),
    list: vi.fn(async () => []),
  },
  task: {
    cancel: vi.fn(async () => true),
    onProgress: vi.fn(() => () => {}),
  },
  app: {
    wslUpdate: vi.fn(async () => ({ taskId: 'up-1' })),
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
    expect(s.running).toHaveLength(0)
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
    expect(s.running).toHaveLength(2)
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
    expect(s.lastError?.code).toBe('UNKNOWN')
    // UNKNOWN 兜底必须把原因带进 message（不许只报「发生未知错误」— review 根治）
    expect(s.lastError?.message).toContain('boom')
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
    // 无 error 字段时用兜底文案，不把最后一条进度 message 当失败原因（review 0.1.2 根治）
    expect(s.byId('a')?.error).toBe('任务执行失败')

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

  it('失败原因消费 TaskProgress.error；终止 message 不再冒充（review 0.1.2 根治）', () => {
    const s = useTasksStore()
    s.track({ taskId: 'e1' }, { type: 'export', message: 'm' })
    // 运行中最后一条 message 是进度文案
    s.applyProgress({
      taskId: 'e1',
      type: 'export',
      percent: 90,
      message: '正在收尾',
      status: 'running',
    })
    s.applyProgress({
      taskId: 'e1',
      type: 'export',
      percent: null,
      message: '导出结束',
      status: 'failed',
      error: '磁盘空间不足',
    })
    expect(s.byId('e1')?.error).toBe('磁盘空间不足')
    expect(s.byId('e1')?.message).toBe('导出结束')
  })

  it('终态重复事件不刷新 finishedAt（结束时间不回拨）', () => {
    vi.useFakeTimers()
    try {
      const s = useTasksStore()
      s.track({ taskId: 'f1' }, { type: 'export', message: 'm' })
      s.applyProgress({
        taskId: 'f1',
        type: 'export',
        percent: 100,
        message: '完成',
        status: 'success',
      })
      const first = s.byId('f1')?.finishedAt
      expect(first).toBeTruthy()
      vi.advanceTimersByTime(5000)
      // 迟到的重复终态事件：finishedAt 保持不变
      s.applyProgress({
        taskId: 'f1',
        type: 'export',
        percent: 100,
        message: '完成',
        status: 'success',
      })
      expect(s.byId('f1')?.finishedAt).toBe(first)
    } finally {
      vi.useRealTimers()
    }
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
    expect(wslAPI.distros.install).toHaveBeenCalledWith({})
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

  it('startConvert 跟踪版本转换任务（M5 兑现）', async () => {
    wslAPI.distros.setVersion = vi.fn(async () => ({ taskId: 'cv-1' }))
    const s = useTasksStore()
    const entry = await s.startConvert('Ubuntu', 2)
    expect(entry?.taskId).toBe('cv-1')
    expect(entry?.type).toBe('convert')
    expect(entry?.message).toBe('转换 Ubuntu 到 WSL2')
    expect(wslAPI.distros.setVersion).toHaveBeenCalledWith('Ubuntu', 2)

    wslAPI.distros.setVersion = vi.fn(async () => {
      throw new Error('WSLPILOT:{"code":"TASK_FAILED","message":"转换失败","recoverable":true}')
    })
    expect(await s.startConvert('U', 1)).toBeNull()
    expect(s.lastError?.message).toBe('转换失败')
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

describe('tasks store：0.1.3/0.1.4 任务入口', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // 前面的用例会整体替换这些 mock（含拒绝实现），此处复位成功实现
    wslAPI.distros.install = vi.fn(async () => ({ taskId: 'ins-1' }))
    wslAPI.distros.setVersion = vi.fn(async () => ({ taskId: 'cv-1' }))
    wslAPI.distros.setSparse = vi.fn(async () => ({ taskId: 'sp-1' }))
    wslAPI.distros.compact = vi.fn(async () => ({ taskId: 'cp-1' }))
    wslAPI.distros.resize = vi.fn(async () => ({ taskId: 'rs-1' }))
    wslAPI.distros.setDefaultUser = vi.fn(async () => ({ taskId: 'du-1' }))
    wslAPI.distros.unregister = vi.fn(async () => ({ taskId: 'un-1' }))
    wslAPI.io.clone = vi.fn(async () => ({ taskId: 'cl-1' }))
  })

  it('install 支持字符串与对象；更新支持预发布通道', async () => {
    const s = useTasksStore()
    await expect(s.startInstall('Ubuntu')).resolves.toMatchObject({ type: 'install' })
    expect(wslAPI.distros.install).toHaveBeenLastCalledWith({ name: 'Ubuntu' })
    await s.startInstall({ name: 'Debian', version: 2 } as never)
    expect(wslAPI.distros.install).toHaveBeenLastCalledWith({ name: 'Debian', version: 2 })
    await s.startUpdate({ preRelease: true })
    expect(wslAPI.app.wslUpdate).toHaveBeenCalledWith({ preRelease: true })
  })

  it('sparse / compact / resize / 默认用户 / 注销 / 转换 / 克隆全部登记任务', async () => {
    const s = useTasksStore()
    await s.startSparse('Ubuntu', true)
    await s.startCompact('Ubuntu', true)
    await s.startResize('Ubuntu', '100GB')
    await s.startSetDefaultUser('Ubuntu', 'dev')
    await s.startUnregister('Ubuntu', { backupFirst: true })
    await s.startConvert('Ubuntu', 2)
    await s.startClone({ name: 'Ubuntu', newName: 'Ubuntu2', installPath: 'D:\\U2' } as never)
    expect(wslAPI.distros.setSparse).toHaveBeenCalledWith('Ubuntu', true)
    expect(wslAPI.distros.compact).toHaveBeenCalledWith('Ubuntu', true)
    expect(wslAPI.distros.resize).toHaveBeenCalledWith('Ubuntu', '100GB')
    expect(wslAPI.distros.setDefaultUser).toHaveBeenCalledWith('Ubuntu', 'dev')
    expect(wslAPI.distros.unregister).toHaveBeenCalledWith('Ubuntu', { backupFirst: true })
    expect(wslAPI.distros.setVersion).toHaveBeenCalledWith('Ubuntu', 2)
    expect(wslAPI.io.clone).toHaveBeenCalled()
    expect(s.entries.map((e) => e.type)).toEqual([
      'manage',
      'manage',
      'manage',
      'manage',
      'unregister',
      'convert',
      'clone',
    ])
  })

  it('所有新任务入口失败时返回 null 并记录 AppError（不抛）', async () => {
    const s = useTasksStore()
    const err = { code: 'TASK_FAILED', message: 'boom', recoverable: true }
    for (const m of [
      wslAPI.distros.install,
      wslAPI.app.wslUpdate,
      wslAPI.distros.setSparse,
      wslAPI.distros.compact,
      wslAPI.distros.resize,
      wslAPI.distros.setDefaultUser,
      wslAPI.distros.unregister,
      wslAPI.distros.setVersion,
      wslAPI.io.clone,
    ]) {
      m.mockRejectedValueOnce(err)
    }
    const runs = [
      () => s.startInstall('Ubuntu'),
      () => s.startUpdate(),
      () => s.startSparse('Ubuntu', true),
      () => s.startCompact('Ubuntu', true),
      () => s.startResize('Ubuntu', '10GB'),
      () => s.startSetDefaultUser('Ubuntu', 'dev'),
      () => s.startUnregister('Ubuntu'),
      () => s.startConvert('Ubuntu', 2),
      () => s.startClone({ name: 'U', newName: 'U2' } as never),
    ]
    for (const run of runs) {
      await expect(run()).resolves.toBeNull()
      expect(s.lastError?.message).toBe('boom')
    }
  })
})

describe('tasks store 剩余 getter/文案分支', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    wslAPI.distros.setSparse = vi.fn(async () => ({ taskId: 'sp-2' }))
    wslAPI.app.wslUpdate = vi.fn(async () => ({ taskId: 'up-2' }))
  })

  it('byId 未知 id 返回 null；applyProgress 补 distro；sparse=false 文案；update 无预发布', async () => {
    const s = useTasksStore()
    expect(s.byId('nope')).toBeNull()
    s.track({ taskId: 't1' }, { type: 'manage', message: 'm' })
    s.applyProgress({
      taskId: 't1',
      type: 'manage',
      distro: 'Ubuntu',
      percent: 1,
      message: 'x',
      status: 'running',
    })
    expect(s.byId('t1')?.distro).toBe('Ubuntu')
    await s.startSparse('Ubuntu', false)
    expect(s.entries.at(-1)?.message).toContain('关闭')
    await s.startUpdate()
    expect(s.entries.at(-1)?.message).toBe('更新 WSL')
  })
})
