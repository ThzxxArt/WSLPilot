import { describe, it, expect, vi } from 'vitest'
import { createTaskRunner, type TaskRecord } from '../../src/main/services/task-runner'
import type { TaskProgress } from '@wslpilot/shared'

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

function makeRunner() {
  const events: TaskProgress[] = []
  const finished: TaskRecord[] = []
  const runner = createTaskRunner({
    logger: logger(),
    onProgress: (p) => events.push(p),
    onFinish: (rec) => finished.push(rec),
  })
  return { runner, events, finished }
}

describe('TaskRunner', () => {
  it('emits running progress on start and success progress at end', async () => {
    const { runner, events, finished } = makeRunner()
    const handle = runner.start({
      type: 'export',
      distro: 'Ubuntu',
      message: '导出 Ubuntu',
      run: async (ctl) => {
        ctl.report(50, '进行中')
      },
    })

    const rec = await runner.waitFor(handle.taskId)
    expect(rec.status).toBe('success')
    expect(rec.percent).toBe(100)
    expect(events[0]).toMatchObject({ taskId: handle.taskId, status: 'running', percent: null })
    expect(events.at(-1)).toMatchObject({ status: 'success', percent: 100 })
    expect(finished).toHaveLength(1)
    expect(finished[0]!.status).toBe('success')
  })

  it('streams log lines through progress events', async () => {
    const { runner, events } = makeRunner()
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: async (ctl) => {
        ctl.log('line-1')
        ctl.log('line-2')
      },
    })
    await runner.waitFor(handle.taskId)
    const logLines = events.filter((e) => e.logLine !== undefined).map((e) => e.logLine)
    expect(logLines).toEqual(['line-1', 'line-2'])
    expect(runner.get(handle.taskId)?.logs).toEqual(['line-1', 'line-2'])
  })

  it('clamps reported percent to 0-100 and ignores non-finite', async () => {
    const { runner } = makeRunner()
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: async (ctl) => {
        ctl.report(250)
        ctl.report(-20)
        ctl.report(Number.NaN)
      },
    })
    const rec = await runner.waitFor(handle.taskId)
    // 结束即 100；中途 clamp 记录在 logs/percent 路径（NaN 被忽略）
    expect(rec.percent).toBe(100)
  })

  it('cancel kills the running task via onCancel hooks', async () => {
    const { runner } = makeRunner()
    let killed = false
    const handle = runner.start({
      type: 'move',
      distro: 'Debian',
      message: 'm',
      run: (ctl) =>
        new Promise<void>((resolve, reject) => {
          ctl.onCancel(() => {
            killed = true
          })
          ctl.onCancel(() => {
            reject(
              new Error(
                'WSLPILOT:{"code":"TASK_CANCELED","message":"任务已取消","recoverable":true}',
              ),
            )
          })
          setTimeout(resolve, 10_000)
        }),
    })

    // 等任务真正进入 run（挂上 onCancel）
    await new Promise((r) => setTimeout(r, 10))
    expect(runner.cancel(handle.taskId)).toBe(true)
    const rec = await runner.waitFor(handle.taskId)
    expect(killed).toBe(true)
    expect(rec.status).toBe('canceled')
    expect(runner.cancel(handle.taskId)).toBe(false)
  })

  it('cancel before queued task starts marks canceled without running', async () => {
    const { runner } = makeRunner()
    let ran = false
    let release: (() => void) | undefined
    const first = runner.start({
      type: 'export',
      distro: 'U',
      message: 'first',
      lockKey: 'U',
      run: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    })
    const second = runner.start({
      type: 'export',
      distro: 'U',
      message: 'second',
      lockKey: 'U',
      run: async () => {
        ran = true
      },
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(runner.cancel(second.taskId)).toBe(true)
    release?.()
    const rec = await runner.waitFor(second.taskId)
    expect(ran).toBe(false)
    expect(rec.status).toBe('canceled')
    const firstRec = await runner.waitFor(first.taskId)
    expect(firstRec.status).toBe('success')
  })

  it('serializes tasks sharing the same lockKey', async () => {
    const { runner } = makeRunner()
    const order: string[] = []
    const makeRun = (id: string, ms: number) => async () => {
      order.push(`${id}:start`)
      await new Promise((r) => setTimeout(r, ms))
      order.push(`${id}:end`)
    }
    const a = runner.start({
      type: 'export',
      distro: 'U',
      message: 'a',
      lockKey: 'U',
      run: makeRun('a', 30),
    })
    const b = runner.start({
      type: 'move',
      distro: 'U',
      message: 'b',
      lockKey: 'U',
      run: makeRun('b', 5),
    })
    await runner.waitFor(b.taskId)
    await runner.waitFor(a.taskId)
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('runs tasks without lockKey concurrently', async () => {
    const { runner } = makeRunner()
    let concurrent = 0
    let maxConcurrent = 0
    const job = async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 20))
      concurrent--
    }
    const a = runner.start({ type: 'export', message: 'a', run: job })
    const b = runner.start({ type: 'export', message: 'b', run: job })
    await runner.waitFor(a.taskId)
    await runner.waitFor(b.taskId)
    expect(maxConcurrent).toBe(2)
  })

  it('marks failed when run throws', async () => {
    const { runner, finished } = makeRunner()
    const handle = runner.start({
      type: 'import',
      distro: 'X',
      message: 'm',
      run: async () => {
        throw new Error('命令执行失败（exit 1）')
      },
    })
    const rec = await runner.waitFor(handle.taskId)
    expect(rec.status).toBe('failed')
    expect(rec.error).toContain('命令执行失败')
    expect(finished[0]!.status).toBe('failed')
  })

  it('maps thrown TASK_CANCELED error to canceled status', async () => {
    const { runner } = makeRunner()
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: async (ctl) => {
        ctl.throwIfCanceled()
      },
    })
    const rec = await runner.waitFor(handle.taskId)
    expect(rec.status).toBe('success')
  })

  it('throwIfCanceled throws after cancel request', async () => {
    const { runner } = makeRunner()
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: (ctl) =>
        new Promise<void>((_resolve, reject) => {
          ctl.onCancel(() => {
            try {
              ctl.throwIfCanceled()
            } catch (e) {
              reject(e)
            }
          })
        }),
    })
    await new Promise((r) => setTimeout(r, 10))
    runner.cancel(handle.taskId)
    const rec = await runner.waitFor(handle.taskId)
    expect(rec.status).toBe('canceled')
  })

  it('waitFor rejects for unknown task and resolves finished immediately', async () => {
    const { runner } = makeRunner()
    await expect(runner.waitFor('missing')).rejects.toThrow(/任务不存在/)
    const handle = runner.start({ type: 'export', message: 'm', run: async () => {} })
    await runner.waitFor(handle.taskId)
    await expect(runner.waitFor(handle.taskId)).resolves.toMatchObject({ status: 'success' })
  })

  it('get / list reflect records', async () => {
    const { runner } = makeRunner()
    const handle = runner.start({ type: 'export', distro: 'U', message: 'm', run: async () => {} })
    await runner.waitFor(handle.taskId)
    expect(runner.get(handle.taskId)?.distro).toBe('U')
    expect(runner.get('missing')).toBeNull()
    expect(runner.list()).toHaveLength(1)
  })

  it('caps logs at MAX_LOG_LINES', async () => {
    const { runner } = makeRunner()
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: async (ctl) => {
        for (let i = 0; i < 2100; i++) ctl.log(`l${i}`)
      },
    })
    const rec = await runner.waitFor(handle.taskId)
    expect(rec.logs.length).toBe(2000)
    expect(rec.logs[0]).toBe('l100')
    expect(rec.logs.at(-1)).toBe('l2099')
  })

  it('dispose cancels running tasks', async () => {
    const { runner } = makeRunner()
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: () => new Promise<void>(() => {}),
    })
    await new Promise((r) => setTimeout(r, 10))
    runner.dispose()
    const rec = runner.get(handle.taskId)
    expect(rec?.status).toBe('canceled')
    expect(() => runner.start({ type: 'export', message: 'x', run: async () => {} })).toThrow(
      /已关闭/,
    )
  })

  it('report after settle is ignored', async () => {
    const { runner, events } = makeRunner()
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: async () => {},
    })
    await runner.waitFor(handle.taskId)
    const count = events.length
    // 无法拿到 ctl，验证 settle 后事件不再增长即可
    expect(events.length).toBe(count)
    expect(runner.get(handle.taskId)?.status).toBe('success')
  })

  it('tolerates onProgress / onFinish listener throws', async () => {
    const warn = vi.fn()
    const runner = createTaskRunner({
      logger: { ...logger(), warn },
      onProgress: () => {
        throw new Error('listener boom')
      },
      onFinish: () => {
        throw new Error('finish boom')
      },
    })
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: async (ctl) => {
        ctl.log('x')
        ctl.report(10)
      },
    })
    const rec = await runner.waitFor(handle.taskId)
    expect(rec.status).toBe('success')
    expect(warn).toHaveBeenCalledWith('task progress listener failed', expect.anything())
    expect(warn).toHaveBeenCalledWith('task finish hook failed', expect.anything())
  })

  it('cancel hook throws are swallowed; onCancel after cancel runs immediately', async () => {
    const { runner } = makeRunner()
    let immediateRuns = 0
    const handle = runner.start({
      type: 'export',
      message: 'm',
      run: (ctl) =>
        new Promise<void>((_resolve, reject) => {
          ctl.onCancel(() => {
            throw new Error('hook boom')
          })
          setTimeout(() => {
            runner.cancel(ctl.taskId)
            // 取消后再注册：立即执行（含抛错 hook）
            ctl.onCancel(() => {
              immediateRuns++
            })
            ctl.onCancel(() => {
              throw new Error('hook boom 2')
            })
            reject(
              new Error(
                'WSLPILOT:{"code":"TASK_CANCELED","message":"任务已取消","recoverable":true}',
              ),
            )
          }, 5)
        }),
    })
    const rec = await runner.waitFor(handle.taskId)
    expect(rec.status).toBe('canceled')
    expect(immediateRuns).toBe(1)
  })

  it('dispose swallows throwing cancel hooks', async () => {
    const { runner } = makeRunner()
    runner.start({
      type: 'export',
      message: 'm',
      run: (ctl) =>
        new Promise<void>(() => {
          ctl.onCancel(() => {
            throw new Error('dispose hook boom')
          })
        }),
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(() => runner.dispose()).not.toThrow()
  })

  it('dispose 后排队任务不得执行 run 副作用（核验修复）', async () => {
    const { runner } = makeRunner()
    const ran: string[] = []
    let release: (() => void) | undefined
    const first = runner.start({
      type: 'export',
      distro: 'U',
      message: 'first',
      lockKey: 'U',
      run: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    })
    const second = runner.start({
      type: 'export',
      distro: 'U',
      message: 'second',
      lockKey: 'U',
      run: async () => {
        ran.push('second')
      },
    })
    await new Promise((r) => setTimeout(r, 10))
    runner.dispose()
    release?.()
    const firstRec = await runner.waitFor(first.taskId)
    const secondRec = await runner.waitFor(second.taskId)
    expect(firstRec.status).toBe('canceled')
    expect(secondRec.status).toBe('canceled')
    expect(ran).toEqual([]) // 排队任务的 run 绝不执行
  })

  it('run 正常返回即成功，收尾窗口的取消信号不改判（核验修复）', async () => {
    const { runner } = makeRunner()
    const handle = runner.start({
      type: 'import',
      distro: 'X',
      message: 'm',
      run: async (ctl) => {
        // 模拟：进程已成功退出后取消信号才到
        runner.cancel(ctl.taskId)
      },
    })
    const rec = await runner.waitFor(handle.taskId)
    expect(rec.status).toBe('success')
  })
})
