import { describe, it, expect, vi } from 'vitest'
import { createTaskRunner } from '../../src/main/services/task-runner'

function logger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  } as never
}

describe('TaskRunner 0.1.4（running / runningForDistro / withLock）', () => {
  it('runningForDistro 大小写归一，只返回运行中任务', async () => {
    const runner = createTaskRunner({ logger: logger(), onProgress: () => {} })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const h1 = runner.start({
      type: 'export',
      distro: 'Ubuntu',
      message: '导出',
      run: () => gate,
    })
    const h2 = runner.start({
      type: 'import',
      distro: 'Debian',
      message: '导入',
      run: async () => {},
    })
    await runner.waitFor(h2.taskId)
    expect(runner.runningForDistro('UBUNTU').map((t) => t.taskId)).toEqual([h1.taskId])
    expect(runner.runningForDistro('debian')).toEqual([])
    release()
    await runner.waitFor(h1.taskId)
  })

  it('withLock 与任务共用同一把 key：直接操作不会被任务的写操作插队', async () => {
    const runner = createTaskRunner({ logger: logger(), onProgress: () => {} })
    const order: string[] = []
    let releaseTask!: () => void
    const taskGate = new Promise<void>((r) => (releaseTask = r))
    const h = runner.start({
      type: 'move',
      distro: 'Ubuntu',
      message: '迁移',
      lockKey: 'ubuntu',
      run: async () => {
        order.push('task-start')
        await taskGate
        order.push('task-end')
      },
    })
    const direct = runner.withLock('ubuntu', async () => {
      order.push('direct')
    })
    releaseTask()
    await Promise.all([runner.waitFor(h.taskId), direct])
    expect(order).toEqual(['task-start', 'task-end', 'direct'])
  })

  it('withLock 在 dispose 后拒绝', async () => {
    const runner = createTaskRunner({ logger: logger(), onProgress: () => {} })
    runner.dispose()
    await expect(runner.withLock('x', async () => 1)).rejects.toThrow(/已关闭/)
  })

  it('direct 操作等待排队任务完成（FIFO）', async () => {
    const runner = createTaskRunner({ logger: logger(), onProgress: () => {} })
    const order: string[] = []
    const h1 = runner.start({
      type: 'export',
      distro: 'Ubuntu',
      message: '导出 1',
      lockKey: 'ubuntu',
      run: async () => {
        order.push('t1')
      },
    })
    const p = runner.withLock('ubuntu', async () => {
      order.push('direct')
    })
    await Promise.all([runner.waitFor(h1.taskId), p])
    expect(order).toEqual(['t1', 'direct'])
  })
})
