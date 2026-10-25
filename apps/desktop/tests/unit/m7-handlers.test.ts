/**
 * M7 IPC handler 回归（review 假信心根治 H5）：
 * update:* 四通道与 app 域诊断/签名三通道此前只有 preload 契约测试，handler 体零执行。
 */
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
  clipboard: {
    readText: vi.fn(() => 'clipboard-content'),
    writeText: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn(),
}))

import { registerAppHandlers } from '../../src/main/ipc/handlers/app'
import { registerUpdateHandlers } from '../../src/main/ipc/handlers/update'
import { CH, type SignatureStatus } from '@wslpilot/shared'
import { SMARTSCREEN_NOTE } from '../../src/main/services/signature-service'
import { clipboard } from 'electron'

function logger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  }
}

function makeCtx(over: Record<string, unknown> = {}) {
  return {
    configService: { userDataDir: '/tmp' },
    logger: logger(),
    getMainWindow: vi.fn(() => ({ webContents: { send: vi.fn() }, close: vi.fn() })),
    ...over,
  } as any
}

function collect(
  register: (add: any, ctx: any) => void,
  ctx: any,
): Map<string, (ctx: unknown, arg: unknown) => unknown> {
  const handlers = new Map<string, (ctx: unknown, arg: unknown) => unknown>()
  register((channel: string, handler: any) => handlers.set(channel, handler), ctx)
  return handlers
}

/** app 域注册（0.1.3：registerAppHandlers 需要 wsl/tasks 依赖） */
function collectApp(ctx: any): Map<string, (ctx: unknown, arg: unknown) => unknown> {
  const handlers = new Map<string, (ctx: unknown, arg: unknown) => unknown>()
  registerAppHandlers((channel: string, handler: any) => handlers.set(channel, handler), ctx, {
    wsl: {
      getVersion: vi.fn(async () => ({ raw: '', wslVersion: '', kernelVersion: '' })),
      getEnv: vi.fn(async () => ({
        installed: true,
        wslVersion: '2.6.1',
        kernelVersion: '6.6.1',
        defaultDistro: 'Ubuntu',
        defaultVersion: 2,
        statusRaw: '',
      })),
      setDefaultVersion: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
    },
    tasks: {
      start: vi.fn(() => ({ taskId: 't1' })),
      running: vi.fn(() => []),
      withLock: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
    },
  } as any)
  return handlers
}

describe('update handlers（M7）', () => {
  beforeEach(() => vi.clearAllMocks())

  const updater = {
    getState: vi.fn(() => ({ status: 'idle', currentVersion: '0.1.0' })),
    check: vi.fn(async () => ({ status: 'available', version: '2.0.0', currentVersion: '0.1.0' })),
    download: vi.fn(async () => ({ status: 'downloaded', currentVersion: '0.1.0' })),
    install: vi.fn(),
  }

  it('update:status 无 updater 时给兜底状态（不抛）', async () => {
    const handlers = collect(registerUpdateHandlers, makeCtx())
    const state = await handlers.get(CH.updateStatus)!(makeCtx(), undefined)
    expect(state).toMatchObject({ status: 'idle', currentVersion: '' })
  })

  it('check / download / install 委托 updater；缺失时抛结构化错误', async () => {
    const ctx = makeCtx({ updater })
    const handlers = collect(registerUpdateHandlers, ctx)

    expect(await handlers.get(CH.updateCheck)!(ctx, undefined)).toMatchObject({
      status: 'available',
    })
    expect(updater.check).toHaveBeenCalled()

    expect(await handlers.get(CH.updateDownload)!(ctx, undefined)).toMatchObject({
      status: 'downloaded',
    })
    expect(updater.download).toHaveBeenCalled()

    await handlers.get(CH.updateInstall)!(ctx, undefined)
    expect(updater.install).toHaveBeenCalled()

    // updater 缺失 → 明确错误（不静默、不半成品）；review 0.1.2：错误码由 UNKNOWN 收敛为 TASK_FAILED
    const bare = collect(registerUpdateHandlers, makeCtx())
    for (const ch of [CH.updateCheck, CH.updateDownload, CH.updateInstall]) {
      await expect(bare.get(ch)!(makeCtx(), undefined)).rejects.toMatchObject({
        code: 'TASK_FAILED',
      })
    }
  })
})

describe('app 域 M7 通道（诊断 / 签名）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('诊断通道名与 API 动词一致（防 app:exportDiagnostics 式命名漂移回归）', () => {
    const handlers = collectApp(makeCtx())
    // 通道尾段动词必须与 preload diagnostics.* API 方法名一致
    for (const [channel, apiVerb] of [
      [CH.diagnosticsExportPackage, 'exportPackage'],
      [CH.diagnosticsOpenLogsDir, 'openLogsDir'],
    ] as const) {
      expect(channel.split(':')[1], `${channel} 通道动词应等于 API 方法名 ${apiVerb}`).toBe(apiVerb)
      expect(handlers.has(channel), `handler 未注册 ${channel}`).toBe(true)
    }
    // 旧 app: 域命名不得复活
    expect([...handlers.keys()]).not.toContain('app:exportDiagnostics')
    expect([...handlers.keys()]).not.toContain('app:openLogsDir')
  })

  it('diagnostics:openLogsDir 委托诊断服务；缺失时抛 IO_ERROR', async () => {
    const openLogsDir = vi.fn(async () => undefined)
    const handlers = collectApp(makeCtx())
    await handlers.get(CH.diagnosticsOpenLogsDir)!(
      makeCtx({ diagnostics: { openLogsDir } }),
      undefined,
    )
    expect(openLogsDir).toHaveBeenCalled()

    await expect(
      handlers.get(CH.diagnosticsOpenLogsDir)!(makeCtx(), undefined),
    ).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })

  it('diagnostics:exportPackage：取消保存 → null；确认 → 规范化扩展名并导出', async () => {
    const exportTo = vi.fn(async (p: string) => ({
      path: p,
      entries: ['manifest.json'],
      sizeBytes: 1,
    }))
    const diagnostics = {
      openLogsDir: vi.fn(),
      exportTo,
      defaultFileName: () => 'WSLPilot-diagnostics-test.zip',
    }
    const handlers = collectApp(makeCtx())

    // 取消
    dialogMocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(
      await handlers.get(CH.diagnosticsExportPackage)!(makeCtx({ diagnostics }), {}),
    ).toBeNull()
    expect(exportTo).not.toHaveBeenCalled()

    // 确认（用户没写 .zip 扩展名 → 补齐）
    dialogMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: 'C:\\out\\diag',
    })
    const result = await handlers.get(CH.diagnosticsExportPackage)!(makeCtx({ diagnostics }), {})
    expect(exportTo).toHaveBeenCalledWith('C:\\out\\diag.zip')
    expect(result).toMatchObject({ path: 'C:\\out\\diag.zip' })

    // 缺失诊断服务
    await expect(handlers.get(CH.diagnosticsExportPackage)!(makeCtx(), {})).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })

  it('app:signatureStatus 委托签名服务；缺失时兜底 SmartScreen 说明', async () => {
    const status = vi.fn(async () => ({ checked: true, signed: true, subject: 'CN=X' }))
    const handlers = collectApp(makeCtx())
    expect(
      await handlers.get(CH.appSignatureStatus)!(makeCtx({ signature: { status } }), undefined),
    ).toMatchObject({ signed: true })

    const fallback = (await handlers.get(CH.appSignatureStatus)!(
      makeCtx(),
      undefined,
    )) as SignatureStatus
    expect(fallback).toMatchObject({ checked: false, signed: false })
    expect(fallback.smartscreenNote).toBe(SMARTSCREEN_NOTE)
  })

  it('app:signatureStatus 服务抛错 → 降级未检测态（不冒泡 UNKNOWN — review 0.1.2 根治）', async () => {
    const status = vi.fn(async () => {
      throw new Error('powershell 崩了')
    })
    const ctx = makeCtx({ signature: { status } })
    const handlers = collectApp(ctx)
    const out = (await handlers.get(CH.appSignatureStatus)!(ctx, undefined)) as SignatureStatus
    expect(out).toMatchObject({ checked: false, signed: false })
    expect(out.detail).toContain('powershell 崩了')
    expect(out.smartscreenNote).toBe(SMARTSCREEN_NOTE)
  })
})

describe('app 域 0.1.3（WSL 本体生命周期 / 剪贴板）', () => {
  beforeEach(() => vi.clearAllMocks())

  function collectWith(wsl: Record<string, unknown>, tasks: Record<string, unknown>) {
    const handlers = new Map<string, (ctx: unknown, arg: unknown) => unknown>()
    registerAppHandlers(
      (channel: string, handler: any) => handlers.set(channel, handler),
      makeCtx(),
      { wsl, tasks } as never,
    )
    return handlers
  }

  it('app:wslEnv 透传环境体检（非抛出语义）', async () => {
    const getEnv = vi.fn(async () => ({
      installed: false,
      wslVersion: '',
      kernelVersion: '',
      defaultDistro: '',
      defaultVersion: null,
      statusRaw: 'wsl.exe 缺失',
    }))
    const handlers = collectWith({ getEnv }, { start: vi.fn() })
    const env = await handlers.get(CH.appWslEnv)!(makeCtx(), undefined)
    expect(env).toMatchObject({ installed: false, statusRaw: 'wsl.exe 缺失' })
    expect(getEnv).toHaveBeenCalled()
  })

  it('app:wslUpdate：任务派发（全局锁串行 + preRelease 透传）', async () => {
    const update = vi.fn(async () => {})
    const starts: Array<Record<string, unknown>> = []
    const tasks = {
      start: vi.fn((opts: Record<string, unknown>) => {
        starts.push(opts)
        return { taskId: `t${starts.length}` }
      }),
      running: vi.fn(() => []),
      withLock: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
    }
    const handlers = collectWith({ update }, tasks)

    const handle = handlers.get(CH.appWslUpdate)!(makeCtx(), { preRelease: true }) as {
      taskId: string
    }
    expect(handle.taskId).toBe('t1')
    expect(starts[0]).toMatchObject({ type: 'update', lockKey: 'wsl:global' })
    const ctl = { taskId: 't1', report: vi.fn(), log: vi.fn() }
    await (starts[0]!.run as (c: unknown) => Promise<void>)(ctl)
    expect(update).toHaveBeenCalledWith(ctl, { preRelease: true })
  })

  it('app:wslSetDefaultVersion 委托服务（仅 1/2 由 schema 保证；走全局锁）', async () => {
    const setDefaultVersion = vi.fn(async () => {})
    const tasks = {
      start: vi.fn(),
      running: vi.fn(() => []),
      withLock: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
    }
    const handlers = collectWith({ setDefaultVersion }, tasks)
    await handlers.get(CH.appWslSetDefaultVersion)!(makeCtx(), { version: 1 })
    expect(setDefaultVersion).toHaveBeenCalledWith(1)
    expect(tasks.withLock).toHaveBeenCalledWith('wsl:global', expect.any(Function))
  })

  it('app:wslSetDefaultVersion 在有按名安装任务时也拒绝（不能只挡无 distro 的本体安装）', async () => {
    const setDefaultVersion = vi.fn(async () => {})
    const tasks = {
      start: vi.fn(),
      running: vi.fn(() => [
        { taskId: 'i1', type: 'install', distro: 'Ubuntu', message: '安装 Ubuntu' },
      ]),
      withLock: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
    }
    const handlers = collectWith({ setDefaultVersion }, tasks)
    await expect(
      handlers.get(CH.appWslSetDefaultVersion)!(makeCtx(), { version: 1 }),
    ).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(setDefaultVersion).not.toHaveBeenCalled()
  })

  it('clipboard:read / write 走主进程 Electron 剪贴板', () => {
    const handlers = collectWith(
      { getEnv: vi.fn(), update: vi.fn(), setDefaultVersion: vi.fn() },
      {
        start: vi.fn(),
        running: vi.fn(() => []),
        withLock: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
      },
    )
    expect(handlers.get(CH.clipboardRead)!(makeCtx(), undefined)).toBe('clipboard-content')
    handlers.get(CH.clipboardWrite)!(makeCtx(), 'hello')
    expect(clipboard.writeText).toHaveBeenCalledWith('hello')
  })
})
