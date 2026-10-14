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
import { CH, parseIpcArgs } from '@wslpilot/shared'
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
  registerAppHandlers(
    (channel, handler) => {
      handlers.set(channel, handler as never)
    },
    ctx,
    {
      wsl: {
        getVersion: vi.fn(async () => ({ raw: '', wslVersion: '', kernelVersion: '' })),
        getEnv: vi.fn(async () => ({
          installed: false,
          wslVersion: '',
          kernelVersion: '',
          defaultDistro: '',
          defaultVersion: null,
          statusRaw: '',
        })),
        setDefaultVersion: vi.fn(),
        update: vi.fn(),
        updateRollback: vi.fn(),
      },
      tasks: { start: vi.fn(() => ({ taskId: 't' })) },
    } as never,
  )
  return { handlers, ctx }
}

function call(
  handlers: Map<string, (ctx: unknown, arg: unknown) => unknown>,
  ctx: unknown,
  channel: string,
  arg: unknown,
) {
  return handlers.get(channel)!(ctx, arg)
}

describe('app dialog handlers (M4 路径选择)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registerAppHandlers 注册面：诊断通道动词与 API 一致且不挂在 app: 域（防命名漂移）', () => {
    const { handlers } = register()
    const names = [...handlers.keys()]
    for (const [channel, apiVerb] of [
      [CH.diagnosticsExportPackage, 'exportPackage'],
      [CH.diagnosticsOpenLogsDir, 'openLogsDir'],
    ] as const) {
      // 通道尾段动词 === preload diagnostics.* API 方法名
      expect(channel.split(':')[1], `${channel} 动词应等于 ${apiVerb}`).toBe(apiVerb)
      expect(names, `handler 未注册 ${channel}`).toContain(channel)
    }
    // 历史漂移命名（app:exportDiagnostics / app:openLogsDir）不得复活
    expect(names).not.toContain('app:exportDiagnostics')
    expect(names).not.toContain('app:openLogsDir')
    // 签名状态仍是 app: 域
    expect(names).toContain(CH.appSignatureStatus)
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

  it('appOpenConfigDir：openPath 返回非空错误串 → IO_ERROR（review 0.1.2 根治）', async () => {
    vi.mocked(shell.openPath).mockResolvedValueOnce('boom')
    const { handlers, ctx } = register()
    await expect(call(handlers, ctx, CH.appOpenConfigDir, undefined)).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })

  it('appOpenPath 只允许目录：文件/不存在路径拒绝，目录走 shell（review C10）', async () => {
    const { handlers, ctx } = register()
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'wslpilot-open-'))
    const file = join(dir, 'evil.exe')
    await writeFile(file, 'x')

    // 目录 → shell.openPath
    vi.mocked(shell.openPath).mockResolvedValueOnce('')
    await expect(call(handlers, ctx, CH.appOpenPath, dir)).resolves.toBeUndefined()
    expect(shell.openPath).toHaveBeenCalledWith(dir)

    // 文件（含可执行）→ 拒绝，绝不走文件关联
    await expect(call(handlers, ctx, CH.appOpenPath, file)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
    expect(shell.openPath).not.toHaveBeenCalledWith(file)

    // 不存在 → IO_ERROR
    await expect(call(handlers, ctx, CH.appOpenPath, join(dir, 'nope'))).rejects.toMatchObject({
      code: 'IO_ERROR',
    })

    // shell 打开失败 → IO_ERROR
    vi.mocked(shell.openPath).mockResolvedValueOnce('boom')
    await expect(call(handlers, ctx, CH.appOpenPath, dir)).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })
})

describe('app:openExternal（review 0.1.2 审计修复：外链专用通道 + 协议白名单）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ipc-schema 契约：仅 http/https 前缀可过，危险协议（含大小写变体）拒绝', () => {
    // 通过：http/https（协议名大小写不敏感，URL 规范允许）
    expect(parseIpcArgs(CH.appOpenExternal, ['https://github.com/dorssel/usbipd-win'])).toBe(
      'https://github.com/dorssel/usbipd-win',
    )
    expect(parseIpcArgs(CH.appOpenExternal, ['http://example.com'])).toBe('http://example.com')
    expect(parseIpcArgs(CH.appOpenExternal, ['HTTP://EXAMPLE.COM'])).toBe('HTTP://EXAMPLE.COM')

    // 拒绝：javascript/file/data 及其大小写变体、无协议串、空串
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'FILE:///etc/passwd',
      'data:text/html,<script>1</script>',
      'github.com/dorssel/usbipd-win',
      '',
    ]) {
      expect(() => parseIpcArgs(CH.appOpenExternal, [bad]), bad).toThrow()
    }
    // 长度上限（防 IPC 撑爆）
    expect(() => parseIpcArgs(CH.appOpenExternal, [`https://x.com/${'a'.repeat(2100)}`])).toThrow()
  })

  it('handler 二次协议校验：危险协议直达 handler 也被拒绝（纵深防御）', async () => {
    const { handlers, ctx } = register()
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
    ]) {
      await expect(call(handlers, ctx, CH.appOpenExternal, bad), bad).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      })
    }
    // 非法 URL（无法解析）→ CONFIG_INVALID
    await expect(call(handlers, ctx, CH.appOpenExternal, 'not a url')).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    })
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('http/https 透传 shell.openExternal；shell 失败映射为 IO_ERROR（不裸抛）', async () => {
    const { handlers, ctx } = register()
    vi.mocked(shell.openExternal).mockResolvedValueOnce(undefined)
    await expect(
      call(handlers, ctx, CH.appOpenExternal, 'https://github.com/dorssel/usbipd-win'),
    ).resolves.toBeUndefined()
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/dorssel/usbipd-win')

    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('no default browser'))
    await expect(
      call(handlers, ctx, CH.appOpenExternal, 'https://example.com'),
    ).rejects.toMatchObject({ code: 'IO_ERROR' })
  })
})
