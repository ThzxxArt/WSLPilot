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
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn(),
}))

import { registerAppHandlers } from '../../src/main/ipc/handlers/app'
import { registerUpdateHandlers } from '../../src/main/ipc/handlers/update'
import { CH, type SignatureStatus } from '@wslpilot/shared'
import { SMARTSCREEN_NOTE } from '../../src/main/services/signature-service'

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

    // updater 缺失 → 明确错误（不静默、不半成品）
    const bare = collect(registerUpdateHandlers, makeCtx())
    for (const ch of [CH.updateCheck, CH.updateDownload, CH.updateInstall]) {
      await expect(bare.get(ch)!(makeCtx(), undefined)).rejects.toMatchObject({
        code: 'UNKNOWN',
      })
    }
  })
})

describe('app 域 M7 通道（诊断 / 签名）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('app:openLogsDir 委托诊断服务；缺失时抛 IO_ERROR', async () => {
    const openLogsDir = vi.fn(async () => undefined)
    const handlers = collect(registerAppHandlers, makeCtx())
    await handlers.get(CH.appOpenLogsDir)!(makeCtx({ diagnostics: { openLogsDir } }), undefined)
    expect(openLogsDir).toHaveBeenCalled()

    await expect(handlers.get(CH.appOpenLogsDir)!(makeCtx(), undefined)).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })

  it('app:exportDiagnostics：取消保存 → null；确认 → 规范化扩展名并导出', async () => {
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
    const handlers = collect(registerAppHandlers, makeCtx())

    // 取消
    dialogMocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await handlers.get(CH.appExportDiagnostics)!(makeCtx({ diagnostics }), {})).toBeNull()
    expect(exportTo).not.toHaveBeenCalled()

    // 确认（用户没写 .zip 扩展名 → 补齐）
    dialogMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: 'C:\\out\\diag',
    })
    const result = await handlers.get(CH.appExportDiagnostics)!(makeCtx({ diagnostics }), {})
    expect(exportTo).toHaveBeenCalledWith('C:\\out\\diag.zip')
    expect(result).toMatchObject({ path: 'C:\\out\\diag.zip' })

    // 缺失诊断服务
    await expect(handlers.get(CH.appExportDiagnostics)!(makeCtx(), {})).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })

  it('app:signatureStatus 委托签名服务；缺失时兜底 SmartScreen 说明', async () => {
    const status = vi.fn(async () => ({ checked: true, signed: true, subject: 'CN=X' }))
    const handlers = collect(registerAppHandlers, makeCtx())
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
})
