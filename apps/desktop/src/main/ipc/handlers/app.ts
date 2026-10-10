import { app, dialog, shell } from 'electron'
import { join } from 'node:path'
import {
  CH,
  createAppError,
  type DiagnosticsExportResult,
  type FileFilter,
  type SignatureStatus,
} from '@wslpilot/shared'
import type { IpcContext } from '../router'
import { normalizeDiagnosticsTarget } from '../../services/diagnostics-service'
import { SMARTSCREEN_NOTE } from '../../services/signature-service'

type AddFn = (
  channel: string, // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

function toElectronFilters(filters?: FileFilter[]): Electron.FileFilter[] | undefined {
  if (!filters || filters.length === 0) return undefined
  return filters.map((f) => ({ name: f.name, extensions: f.extensions }))
}

export function registerAppHandlers(add: AddFn, _ctx: IpcContext): void {
  add(CH.appGetVersion, () => app.getVersion())

  add(CH.appOpenConfigDir, (c) => {
    return shell.openPath(c.configService.userDataDir)
  })

  add(CH.appGetWslVersion, async (c) => {
    if (!c.wsl) return { raw: '', wslVersion: '', kernelVersion: '' }
    return c.wsl.getVersion()
  })

  add(CH.appWindowMinimize, (c) => {
    c.getMainWindow()?.minimize()
  })

  add(CH.appWindowMaximize, (c) => {
    const win = c.getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  add(CH.appWindowClose, (c) => {
    const win = c.getMainWindow()
    if (!win) return
    win.close()
  })

  // ── 系统文件对话框（M4 备份迁移向导选路径）──
  add(CH.appPickDirectory, async (c, arg: never): Promise<string | null> => {
    const o = (arg ?? {}) as { defaultPath?: string }
    const win = c.getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: o.defaultPath,
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
  })

  add(CH.appPickSaveFile, async (c, arg: never): Promise<string | null> => {
    const o = (arg ?? {}) as {
      defaultPath?: string
      suggestedName?: string
      filters?: FileFilter[]
    }
    const win = c.getMainWindow()
    const opts: Electron.SaveDialogOptions = {
      title: '选择保存位置',
      defaultPath: o.defaultPath ?? o.suggestedName,
      filters: toElectronFilters(o.filters),
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return result.canceled || !result.filePath ? null : result.filePath
  })

  add(CH.appPickOpenFile, async (c, arg: never): Promise<string | null> => {
    const o = (arg ?? {}) as { defaultPath?: string; filters?: FileFilter[] }
    const win = c.getMainWindow()
    const opts: Electron.OpenDialogOptions = {
      title: '选择文件',
      properties: ['openFile'],
      defaultPath: o.defaultPath,
      filters: toElectronFilters(o.filters),
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
  })

  add(CH.appOpenPath, async (_c, target: never): Promise<void> => {
    const p = String(target)
    // 只允许打开【目录】：shell.openPath 对文件走系统关联，.exe/.bat/.vbs 可被拉起（review C10）
    const { statSync } = await import('node:fs')
    let isDir = false
    try {
      isDir = statSync(p).isDirectory()
    } catch {
      throw createAppError('IO_ERROR', {
        message: '路径不存在或不可访问',
        detail: p,
        suggestion: '请检查路径是否有效',
      })
    }
    if (!isDir) {
      throw createAppError('PERMISSION_DENIED', {
        message: '出于安全考虑只允许打开目录',
        detail: p,
        suggestion: '请选择文件夹而不是文件',
      })
    }
    const err = await shell.openPath(p)
    if (err) {
      throw createAppError('IO_ERROR', { message: '无法打开目录', detail: err })
    }
  })

  // ── M7 诊断包 / 日志目录 / 签名状态 ──
  add(CH.appOpenLogsDir, async (c): Promise<void> => {
    if (!c.diagnostics) {
      throw createAppError('IO_ERROR', { message: '诊断服务未初始化' })
    }
    await c.diagnostics.openLogsDir()
  })

  add(CH.appExportDiagnostics, async (c, arg: never): Promise<DiagnosticsExportResult | null> => {
    if (!c.diagnostics) {
      throw createAppError('IO_ERROR', { message: '诊断服务未初始化' })
    }
    const o = (arg ?? {}) as { defaultPath?: string }
    const suggested = c.diagnostics.defaultFileName()
    const opts: Electron.SaveDialogOptions = {
      title: '导出诊断包（近期日志 + 配置脱敏副本）',
      defaultPath: o.defaultPath ? join(o.defaultPath, suggested) : suggested,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    }
    const win = c.getMainWindow()
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    const target = normalizeDiagnosticsTarget(result.filePath)
    return c.diagnostics.exportTo(target)
  })

  add(CH.appSignatureStatus, async (c): Promise<SignatureStatus> => {
    if (c.signature) return c.signature.status()
    return { checked: false, signed: false, smartscreenNote: SMARTSCREEN_NOTE }
  })
}
