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
    const spawn = ((
      args: string[],
      opts: { onLine: (l: string) => void; onExit: (c: number) => void },
    ) => {
      void args
      opts.onLine('hello')
      opts.onExit(0)
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
      opts.onExit(3)
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    await expect(spawnWslTask(['x'], makeCtl(), logger(), spawn)).rejects.toMatchObject({
      code: 'TASK_FAILED',
      rawCommand: expect.stringContaining('wsl.exe x'),
    })
  })

  it('exit 0 优先于取消状态（review M8）', async () => {
    const spawn = ((_a: string[], opts: { onExit: (c: number) => void }) => {
      opts.onExit(0)
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    const ctl = makeCtl({ isCanceled: () => true })
    await expect(spawnWslTask(['x'], ctl, logger(), spawn)).resolves.toBeUndefined()
  })

  it('非零退出 + 已取消 → TASK_CANCELED', async () => {
    const spawn = ((_a: string[], opts: { onExit: (c: number) => void }) => {
      opts.onExit(1)
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    const ctl = makeCtl({ isCanceled: () => true })
    await expect(spawnWslTask(['x'], ctl, logger(), spawn)).rejects.toMatchObject({
      code: 'TASK_CANCELED',
    })
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
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
      await expect(promise).rejects.toMatchObject({
        code: 'TASK_FAILED',
        message: expect.stringContaining('无响应'),
      })
      expect(killed).toBe(true)
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
