import { describe, it, expect, vi } from 'vitest'
import { spawnWslTask, type SpawnWslFn } from '../../src/main/services/spawn-task'
import type { TaskControl } from '../../src/main/services/task-runner'

function logger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  } as any
}

function makeCtl(over: Partial<TaskControl> = {}): TaskControl {
  return {
    taskId: 't',
    type: 'export',
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: () => {},
    onCancel: vi.fn(),
    ...over,
  }
}

describe('spawnWslTask', () => {
  it('resolve on exit 0 and logs lines', async () => {
    const lines: string[] = []
    // 异步 onExit：对齐真实 spawn 事件序（同步触发会掩盖 kill/exit 交错 — review m1）
    const spawn = ((
      args: string[],
      opts: { onLine: (l: string) => void; onExit: (c: number) => void },
    ) => {
      void args
      opts.onLine('hello')
      queueMicrotask(() => opts.onExit(0))
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    const ctl = makeCtl({
      log: (l: string) => lines.push(l),
    })
    await spawnWslTask(['--list'], ctl, logger(), spawn)
    expect(lines).toContain('hello')
    expect(lines[0]).toContain('wsl.exe --list')
  })

  it('rejects TASK_FAILED on non-zero exit with tail detail', async () => {
    const spawn = ((
      _a: string[],
      opts: { onLine: (l: string) => void; onExit: (c: number) => void },
    ) => {
      opts.onLine('err-line')
      queueMicrotask(() => opts.onExit(3))
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    const promise = spawnWslTask(['x'], makeCtl(), logger(), spawn)
    // 先挂断言再等待：拒绝发生在微任务，晚挂载会被判 unhandled
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'TASK_FAILED',
      rawCommand: expect.stringContaining('wsl.exe x'),
    })
    await assertion
  })

  it('exit 0 优先于取消状态（review M8）', async () => {
    const spawn = ((_a: string[], opts: { onExit: (c: number) => void }) => {
      queueMicrotask(() => opts.onExit(0))
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    const ctl = makeCtl({ isCanceled: () => true })
    await expect(spawnWslTask(['x'], ctl, logger(), spawn)).resolves.toBeUndefined()
  })

  it('非零退出 + 已取消 → TASK_CANCELED', async () => {
    const spawn = ((_a: string[], opts: { onExit: (c: number) => void }) => {
      queueMicrotask(() => opts.onExit(1))
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    const ctl = makeCtl({ isCanceled: () => true })
    const promise = spawnWslTask(['x'], ctl, logger(), spawn)
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'TASK_CANCELED',
    })
    await assertion
  })

  it('spawn error → TASK_FAILED', async () => {
    const spawn = ((_a: string[], opts: { onError: (e: Error) => void }) => {
      opts.onError(new Error('spawn fail'))
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    await expect(spawnWslTask(['x'], makeCtl(), logger(), spawn)).rejects.toMatchObject({
      code: 'TASK_FAILED',
      message: expect.stringContaining('spawn fail'),
    })
  })

  it('spawnFn 同步抛错 → reject 且不残留定时器（catch 分支 — review）', async () => {
    const spawn = (() => {
      throw new Error('sync boom')
    }) as unknown as SpawnWslFn
    await expect(spawnWslTask(['x'], makeCtl(), logger(), spawn)).rejects.toThrow('sync boom')
  })

  it('看门狗 kill 无响应时 100ms 兜底 reject，且定时器被清理（review 根治）', async () => {
    vi.useFakeTimers()
    try {
      // kill 不触发 onExit：模拟 ConPTY 卡死/进程无法回收
      const spawn = (() => ({ kill: vi.fn() })) as unknown as SpawnWslFn
      const promise = spawnWslTask(['x'], makeCtl(), logger(), spawn)
      const assertion = expect(promise).rejects.toMatchObject({
        code: 'TASK_FAILED',
        message: expect.stringContaining('无响应'),
      })
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
      await assertion
      // watchdog interval + 100ms 兜底 timer 都必须被 done 清理（不来清理则泄漏）
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('非零退出时 tail 只保留最后 20 行（detail 不无界增长）', async () => {
    let optsRef: { onLine: (l: string) => void; onExit: (c: number) => void } | null = null
    const spawn = ((_a: string[], opts: never) => {
      optsRef = opts
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    const settled = spawnWslTask(['x'], makeCtl(), logger(), spawn).catch((e) => e)
    for (let i = 1; i <= 25; i++) optsRef!.onLine(`line-${i}`)
    optsRef!.onExit(1)
    const err = await settled
    const kept = String(err.detail).split('\n')
    expect(kept).toHaveLength(20)
    expect(kept[0]).toContain('line-6')
    expect(kept[19]).toContain('line-25')
  })

  it('watchdog kills hung command after idle timeout', async () => {
    vi.useFakeTimers()
    try {
      let killed = false
      const spawn = ((_a: string[], opts: { onExit: (c: number) => void }) => ({
        kill: () => {
          killed = true
          opts.onExit(-1)
        },
      })) as unknown as SpawnWslFn
      const promise = spawnWslTask(['x'], makeCtl(), logger(), spawn)
      // 先挂断言再推进计时器：拒绝发生在 advance 期间，晚挂载会被判 unhandled（核验修复）
      const assertion = expect(promise).rejects.toMatchObject({
        code: 'TASK_FAILED',
        message: expect.stringContaining('无响应'),
      })
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
      await assertion
      expect(killed).toBe(true)
      // kill 同步触发退出即结算：不得再残留无人管理的兜底/看门狗定时器
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancel hook kill 触发拒绝（TASK_CANCELED 由上层判定）', async () => {
    let killFn: (() => void) | null = null
    const spawn = ((_a: string[], opts: { onExit: (c: number) => void }) => {
      killFn = () => opts.onExit(1)
      return { kill: () => killFn?.() }
    }) as unknown as SpawnWslFn
    const ctl = makeCtl({
      onCancel: (fn) => {
        // 立即模拟取消
        queueMicrotask(() => {
          fn()
        })
      },
      isCanceled: () => true,
    })
    await expect(spawnWslTask(['x'], ctl, logger(), spawn)).rejects.toMatchObject({
      code: 'TASK_CANCELED',
    })
  })
})
