import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerIoHandlers } from '../../src/main/ipc/handlers/io'
import { CH } from '@wslpilot/shared'
import type { TaskControl } from '../../src/main/services/task-runner'

function makeDeps() {
  const runs: TaskControl[] = []
  const deps = {
    io: {
      runExport: vi.fn(async (_req: unknown, ctl: TaskControl) => {
        runs.push(ctl)
        ctl.report(100, '导出完成')
        return {}
      }),
      runImport: vi.fn(async (_req: unknown, ctl: TaskControl) => {
        runs.push(ctl)
      }),
      runMove: vi.fn(async (_req: unknown, ctl: TaskControl) => {
        runs.push(ctl)
      }),
      listBackups: vi.fn(async (dir?: string) => [{ dir }]),
      resolveBackupDir: vi.fn(() => '/tmp/bk'),
      rotateBackups: vi.fn(async () => 0),
    } as any,
    tasks: {
      start: vi.fn(
        (opts: {
          type: string
          distro?: string
          message: string
          lockKey?: string
          run: (ctl: TaskControl) => Promise<void>
        }) => {
          const ctl: TaskControl = {
            taskId: 'task-1',
            type: opts.type as never,
            distro: opts.distro,
            report: vi.fn(),
            log: vi.fn(),
            isCanceled: () => false,
            throwIfCanceled: () => {},
            onCancel: vi.fn(),
          }
          void opts.run(ctl)
          return { taskId: 'task-1' }
        },
      ),
      cancel: vi.fn(() => true),
      get: vi.fn(() => null),
      list: vi.fn(() => []),
      waitFor: vi.fn(async () => ({})),
      dispose: vi.fn(),
    } as any,
    runs,
  }
  return deps
}

function register() {
  const handlers = new Map<string, (ctx: unknown, arg: unknown) => unknown>()
  const deps = makeDeps()
  registerIoHandlers((channel, handler) => {
    handlers.set(channel, handler as never)
  }, deps)
  return { handlers, deps }
}

describe('io IPC handlers (M4)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('io:export starts locked export task', async () => {
    const { handlers, deps } = register()
    const handle = await handlers.get(CH.ioExport)!(
      {},
      {
        name: 'Ubuntu',
        path: 'C:\\b\\u.tar',
        format: 'tar',
      },
    )
    expect(handle).toEqual({ taskId: 'task-1' })
    expect(deps.tasks.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'export', distro: 'Ubuntu', lockKey: 'ubuntu' }),
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(deps.io.runExport).toHaveBeenCalledWith(
      { name: 'Ubuntu', path: 'C:\\b\\u.tar', format: 'tar' },
      expect.anything(),
    )
  })

  it('io:import starts import task with payload', async () => {
    const { handlers, deps } = register()
    const payload = {
      name: 'New',
      installPath: 'D:\\N',
      archivePath: 'D:\\a.tar',
      format: 'tar',
      version: 2,
      inPlace: false,
    }
    await handlers.get(CH.ioImport)!({}, payload)
    expect(deps.tasks.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'import', distro: 'New' }),
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(deps.io.runImport).toHaveBeenCalledWith(payload, expect.anything())
  })

  it('io:move starts move task', async () => {
    const { handlers, deps } = register()
    await handlers.get(CH.ioMove)!({}, { name: 'U', path: 'D:\\U', terminateFirst: true })
    expect(deps.tasks.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'move', distro: 'U', message: '迁移 U' }),
    )
  })

  it('io:listBackups forwards optional dir', async () => {
    const { handlers, deps } = register()
    expect(await handlers.get(CH.ioListBackups)!({}, {})).toEqual([{ dir: undefined }])
    expect(await handlers.get(CH.ioListBackups)!({}, { dir: 'D:\\bk' })).toEqual([
      { dir: 'D:\\bk' },
    ])
    expect(deps.io.listBackups).toHaveBeenCalledTimes(2)
  })

  it('task:cancel delegates to runner', () => {
    const { handlers, deps } = register()
    expect(handlers.get(CH.taskCancel)!({}, 'task-1')).toBe(true)
    expect(deps.tasks.cancel).toHaveBeenCalledWith('task-1')
  })
})
