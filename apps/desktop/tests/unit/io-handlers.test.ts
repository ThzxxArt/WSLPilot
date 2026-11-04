import { describe, it, expect, vi } from 'vitest'
import { CH } from '@wslpilot/shared'
import { registerWslConfigHandlers } from '../../src/main/ipc/handlers/wslconfig'
import { registerIoHandlers } from '../../src/main/ipc/handlers/io'
import type { IpcContext } from '../../src/main/ipc/router'

type Handler = (ctx: IpcContext, arg: unknown) => unknown
const ctx = {} as IpcContext

describe('wslconfig / io handlers', () => {
  it('wslconfig 读写透传', async () => {
    const handlers = new Map<string, Handler>()
    const wslconfig = {
      read: vi.fn(async () => ({ path: 'C:\\Users\\me\\.wslconfig', exists: true, content: 'x' })),
      write: vi.fn(async () => ({ path: 'C:\\Users\\me\\.wslconfig' })),
    }
    registerWslConfigHandlers(((ch: string, fn: Handler) => handlers.set(ch, fn)) as never, {
      wslconfig: wslconfig as never,
    })
    await expect(handlers.get(CH.wslconfigRead)!(ctx, undefined)).resolves.toMatchObject({
      exists: true,
    })
    await expect(
      handlers.get(CH.wslconfigWrite)!(ctx, { content: '[wsl2]\nmemory=8GB' }),
    ).resolves.toHaveProperty('path')
    expect(wslconfig.write).toHaveBeenCalledWith('[wsl2]\nmemory=8GB')
  })

  it('io 任务通道执行 service；listBackups/cleanup/taskCancel 参数默认值', async () => {
    const handlers = new Map<string, Handler>()
    const io = {
      runExport: vi.fn(async () => ({})),
      runImport: vi.fn(async () => {}),
      runMove: vi.fn(async () => {}),
      runClone: vi.fn(async () => {}),
      listBackups: vi.fn(async () => []),
      cleanupBackups: vi.fn(async () => ({ removed: 0 })),
    }
    const tasks = {
      start: vi.fn((opts: { run: (ctl: unknown) => Promise<void> }) => {
        void opts.run({})
        return { taskId: 't1' }
      }),
      cancel: vi.fn(() => true),
    }
    registerIoHandlers(((ch: string, fn: Handler) => handlers.set(ch, fn)) as never, {
      io: io as never,
      tasks: tasks as never,
    })

    await handlers.get(CH.ioExport)!(ctx, { name: 'Ubuntu', path: 'C:\\b\\u.tar', format: 'tar' })
    await handlers.get(CH.ioImport)!(ctx, {
      name: 'U',
      installPath: 'D:\\U',
      archivePath: 'D:\\a.tar',
      format: 'tar',
      version: 2,
      inPlace: false,
    })
    await handlers.get(CH.ioMove)!(ctx, { name: 'U', path: 'D:\\U', terminateFirst: true })
    await handlers.get(CH.ioClone)!(ctx, { name: 'U', newName: 'U2', installPath: 'D:\\U2' })
    await vi.waitFor(() => expect(io.runClone).toHaveBeenCalled())
    expect(io.runExport).toHaveBeenCalled()
    expect(io.runImport).toHaveBeenCalled()
    expect(io.runMove).toHaveBeenCalled()

    await handlers.get(CH.ioListBackups)!(ctx, undefined)
    expect(io.listBackups).toHaveBeenCalledWith(undefined)
    await handlers.get(CH.ioListBackups)!(ctx, { dir: 'D:\\b' })
    expect(io.listBackups).toHaveBeenCalledWith('D:\\b')

    await handlers.get(CH.ioCleanupBackups)!(ctx, undefined)
    expect(io.cleanupBackups).toHaveBeenCalledWith(undefined, expect.any(Number))
    await handlers.get(CH.ioCleanupBackups)!(ctx, { dir: 'D:\\b', keep: 3 })
    expect(io.cleanupBackups).toHaveBeenCalledWith('D:\\b', 3)

    expect(handlers.get(CH.taskCancel)!(ctx, 't1')).toBe(true)
    expect(tasks.cancel).toHaveBeenCalledWith('t1')
  })
})
