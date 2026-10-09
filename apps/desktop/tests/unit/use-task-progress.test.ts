import { describe, it, expect, beforeEach, vi } from 'vitest'

const wslAPI = {
  task: {
    cancel: vi.fn(async () => true),
    onProgress: vi.fn((_cb: (p: unknown) => void): (() => void) => () => {}),
  },
  io: {
    export: vi.fn(),
    import: vi.fn(),
    move: vi.fn(),
    listBackups: vi.fn(async () => []),
  },
}
;(globalThis as any).window = { wslAPI }

const { useTasksStore } = await import('../../src/renderer/stores/tasks')
const { attachTaskProgress, useTaskProgress, formatElapsed, taskTypeLabel, taskStatusLabel } =
  await import('../../src/renderer/composables/useTaskProgress')
const { createPinia, setActivePinia } = await import('pinia')
const { ref } = await import('vue')

describe('attachTaskProgress', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('subscribes to task:progress and feeds the store', () => {
    let handler: ((p: unknown) => void) | undefined
    wslAPI.task.onProgress.mockImplementation((cb: (p: unknown) => void) => {
      handler = cb
      return () => {
        handler = undefined
      }
    })
    const seen: string[] = []
    const off = attachTaskProgress((p) => seen.push(p.status))

    handler?.({
      taskId: 't1',
      type: 'export',
      percent: 10,
      message: 'm',
      status: 'running',
      logLine: 'l1',
    })
    const store = useTasksStore()
    expect(store.byId('t1')?.percent).toBe(10)
    expect(store.byId('t1')?.logs).toEqual(['l1'])
    expect(seen).toEqual(['running'])

    off()
    expect(handler).toBeUndefined()
  })

  it('tolerates missing wslAPI', () => {
    const saved = (globalThis as any).window.wslAPI
    ;(globalThis as any).window.wslAPI = undefined
    const off = attachTaskProgress()
    expect(typeof off).toBe('function')
    off()
    ;(globalThis as any).window.wslAPI = saved
  })
})

describe('useTaskProgress', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('exposes reactive task view for a ref taskId', async () => {
    const store = useTasksStore()
    store.track({ taskId: 'abc' }, { type: 'export', distro: 'U', message: '导出 U' })
    const id = ref('abc')
    const view = useTaskProgress(id)

    expect(view.task.value?.taskId).toBe('abc')
    expect(view.percent.value).toBeNull()
    expect(view.percentLabel.value).toBe('进行中…')
    expect(view.isRunning.value).toBe(true)
    expect(view.isDone.value).toBe(false)

    store.applyProgress({
      taskId: 'abc',
      type: 'export',
      percent: 42.4,
      message: 'm',
      status: 'running',
    })
    expect(view.percent.value).toBe(42.4)
    expect(view.percentLabel.value).toBe('42%')

    store.applyProgress({
      taskId: 'abc',
      type: 'export',
      percent: 100,
      message: '完成',
      status: 'success',
    })
    expect(view.isRunning.value).toBe(false)
    expect(view.isDone.value).toBe(true)

    id.value = ''
    expect(view.task.value).toBeNull()
  })

  it('accepts plain string taskId and cancels via store', async () => {
    const store = useTasksStore()
    store.track({ taskId: 'plain' }, { type: 'move', message: 'm' })
    const view = useTaskProgress('plain')
    expect(view.task.value?.taskId).toBe('plain')
    await view.cancel()
    expect(wslAPI.task.cancel).toHaveBeenCalledWith('plain')
    await view.cancel() // 空 id 时不抛
  })

  it('empty id → null task, cancel no-op', async () => {
    const view = useTaskProgress('')
    expect(view.task.value).toBeNull()
    await view.cancel()
    expect(wslAPI.task.cancel).not.toHaveBeenCalled()
  })
})

describe('label helpers', () => {
  it('formatElapsed renders mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(1000)).toBe('00:01')
    expect(formatElapsed(65_000)).toBe('01:05')
    expect(formatElapsed(-5)).toBe('00:00')
  })

  it('taskTypeLabel / taskStatusLabel map known values', () => {
    expect(taskTypeLabel('export')).toBe('导出备份')
    expect(taskTypeLabel('import')).toBe('导入恢复')
    expect(taskTypeLabel('move')).toBe('迁移磁盘')
    expect(taskTypeLabel('install')).toBe('安装')
    expect(taskTypeLabel('convert')).toBe('版本转换')
    expect(taskTypeLabel('action')).toBe('自定义动作')
    expect(taskTypeLabel('weird')).toBe('weird')

    expect(taskStatusLabel('running')).toBe('进行中')
    expect(taskStatusLabel('success')).toBe('已完成')
    expect(taskStatusLabel('failed')).toBe('失败')
    expect(taskStatusLabel('canceled')).toBe('已取消')
    expect(taskStatusLabel('x')).toBe('x')
  })
})
