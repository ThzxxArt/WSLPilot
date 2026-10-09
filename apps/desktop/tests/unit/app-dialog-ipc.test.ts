import { describe, it, expect, beforeEach, vi } from 'vitest'

const dialogMocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.1.0'),
    getPath: vi.fn(() => '/tmp'),
  },
  shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn() },
  dialog: dialogMocks,
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn(),
}))

import { registerAppHandlers } from '../../src/main/ipc/handlers/app'
import { CH } from '@wslpilot/shared'
import { shell } from 'electron'

function register(withWindow = true) {
  const handlers = new Map<string, (ctx: unknown, arg: unknown) => unknown>()
  const ctx = {
    configService: { userDataDir: '/tmp' },
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLevel: vi.fn(),
    },
    getMainWindow: vi.fn(() =>
      withWindow ? { webContents: { send: vi.fn() }, close: vi.fn() } : null,
    ),
  } as never
  registerAppHandlers((channel, handler) => {
    handlers.set(channel, handler as never)
  }, ctx)
  return { handlers, ctx }
}

function call(handlers: Map<string, (ctx: unknown, arg: unknown) => unknown>, ctx: unknown, channel: string, arg: unknown) {
  return handlers.get(channel)!(ctx, arg)
}

describe('app dialog handlers (M4 路径选择)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pickDirectory returns selected path', async () => {
    dialogMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\sel'] })
    const { handlers, ctx } = register()
    const out = await call(handlers, ctx, CH.appPickDirectory, { defaultPath: 'D:\\x' })
    expect(out).toBe('D:\\sel')
    expect(dialogMocks.showOpenDialog).toHaveBeenCalled()
  })

  it('pickDirectory returns null on cancel and works without window', async () => {
    dialogMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const { handlers, ctx } = register(false)
    expect(await call(handlers, ctx, CH.appPickDirectory, {})).toBeNull()
    dialogMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })
    expect(await call(handlers, ctx, CH.appPickDirectory, {})).toBeNull()
  })

  it('pickSaveFile returns filePath and passes filters', async () => {
    dialogMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'D:\\out.tar' })
    const { handlers, ctx } = register()
    const out = await call(handlers, ctx, CH.appPickSaveFile, {
      suggestedName: 'a.tar',
      filters: [{ name: 'TAR', extensions: ['tar'] }],
    })
    expect(out).toBe('D:\\out.tar')
    const opts = dialogMocks.showSaveDialog.mock.calls[0]![1]
    expect(opts.filters).toEqual([{ name: 'TAR', extensions: ['tar'] }])
  })

  it('pickSaveFile returns null when canceled', async () => {
    dialogMocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    const { handlers, ctx } = register()
    expect(await call(handlers, ctx, CH.appPickSaveFile, {})).toBeNull()
  })

  it('pickOpenFile returns first path / null on cancel', async () => {
    dialogMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\in.tar'] })
    const { handlers, ctx } = register()
    expect(await call(handlers, ctx, CH.appPickOpenFile, {})).toBe('D:\\in.tar')
    dialogMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })
    expect(await call(handlers, ctx, CH.appPickOpenFile, {})).toBeNull()
  })

  it('appOpenPath surfaces shell errors as IO_ERROR', async () => {
    const { handlers, ctx } = register()
    vi.mocked(shell.openPath).mockResolvedValueOnce('boom')
    await expect(call(handlers, ctx, CH.appOpenPath, 'D:\\x')).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
    vi.mocked(shell.openPath).mockResolvedValueOnce('')
    await expect(call(handlers, ctx, CH.appOpenPath, 'D:\\x')).resolves.toBeUndefined()
  })
})
