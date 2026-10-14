import { app, clipboard, dialog, shell } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import {
  CH,
  WSL_GLOBAL_LOCK,
  createAppError,
  type DiagnosticsExportResult,
  type FileFilter,
  type SignatureStatus,
  type TaskHandle,
  type WslEnvInfo,
} from '@wslpilot/shared'
import type { IpcContext } from '../router'
import type { WslService } from '../../services/wsl-service'
import type { TaskRunner } from '../../services/task-runner'
import { normalizeDiagnosticsTarget } from '../../services/diagnostics-service'
import { SMARTSCREEN_NOTE } from '../../services/signature-service'

type AddFn = (
  channel: string, // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

export interface AppHandlerDeps {
  wsl: WslService
  tasks: TaskRunner
}

function toElectronFilters(filters?: FileFilter[]): Electron.FileFilter[] | undefined {
  if (!filters || filters.length === 0) return undefined
  return filters.map((f) => ({ name: f.name, extensions: f.extensions }))
}

export function registerAppHandlers(add: AddFn, _ctx: IpcContext, deps: AppHandlerDeps): void {
  add(CH.appGetVersion, () => app.getVersion())

  add(CH.appOpenConfigDir, async (c): Promise<void> => {
    // review 0.1.2 根治：openPath 的失败以「非空错误串」返回而非抛出，原实现直接透传字符串，
    // 渲染层看不到结构化错误 —— 统一映射为 AppError
    const err = await shell.openPath(c.configService.userDataDir)
    if (err) {
      throw createAppError('IO_ERROR', {
        message: '无法打开配置目录',
        detail: err,
        suggestion: '请检查目录是否存在或稍后重试',
      })
    }
  })

  add(CH.appGetWslVersion, async () => {
    return deps.wsl.getVersion()
  })

  /**
   * WSL 环境体检（0.1.3）：非抛出语义 —— 未安装 WSL 时返回 installed:false + 原始输出，
   * 由「一键安装」引导消费；调用失败（服务异常）也降级为未安装态并携带原因。
   */
  add(CH.appWslEnv, async (): Promise<WslEnvInfo> => {
    return deps.wsl.getEnv()
  })

  /**
   * 更新 WSL（0.1.3）：长任务（流式日志 + 可取消 + 提权降级）。
   * 与「安装 WSL 本体」共用 WSL_GLOBAL_LOCK，本体级操作严格串行。
   */
  add(CH.appWslUpdate, (_c, arg: never): TaskHandle => {
    const o = (arg ?? {}) as { preRelease?: boolean }
    return deps.tasks.start({
      type: 'update',
      message: o.preRelease ? '更新 WSL（预发布通道）' : '更新 WSL',
      lockKey: WSL_GLOBAL_LOCK,
      run: (ctl) => deps.wsl.update(ctl, { preRelease: o.preRelease === true }),
    })
  })

  /** 回滚最近一次 WSL 更新（0.1.3）：危险操作，二次确认由渲染层负责 */
  add(CH.appWslUpdateRollback, (): TaskHandle => {
    return deps.tasks.start({
      type: 'update',
      message: '回滚 WSL 更新',
      lockKey: WSL_GLOBAL_LOCK,
      run: (ctl) => deps.wsl.updateRollback(ctl),
    })
  })

  /** 设置默认 WSL 版本（0.1.3）：仅影响新导入的发行版 */
  add(CH.appWslSetDefaultVersion, async (_c, arg: never): Promise<void> => {
    const o = arg as { version: 1 | 2 }
    await deps.wsl.setDefaultVersion(o.version)
  })

  /** 剪贴板读取（0.1.3 终端粘贴可靠通道 — Electron clipboard，不受 file:// 权限限制） */
  add(CH.clipboardRead, (): string => clipboard.readText())

  /** 剪贴板写入（0.1.3 终端复制可靠通道） */
  add(CH.clipboardWrite, (_c, arg: never): void => {
    clipboard.writeText(String(arg ?? ''))
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
    // review 0.1.2 根治：statSync 会阻塞主进程事件循环 —— 改异步 stat
    let isDir = false
    try {
      isDir = (await fsp.stat(p)).isDirectory()
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

  /**
   * 外链打开（review 0.1.2 审计修复）：
   * 根因：官网按钮误用 app:openPath（只允许目录）→ 100% 失败。新增专用通道。
   * 协议白名单二次校验（schema 已挡一层）：URL 解析归一化后仅放行 http/https，
   * `JaVaScRiPt:` 等大小写变体、file:/data: 一律拒绝；shell 失败映射为 AppError。
   */
  add(CH.appOpenExternal, async (_c, target: never): Promise<void> => {
    const url = String(target)
    let protocol = ''
    try {
      protocol = new URL(url).protocol
    } catch {
      throw createAppError('CONFIG_INVALID', {
        message: '链接格式非法',
        detail: url,
      })
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw createAppError('PERMISSION_DENIED', {
        message: '出于安全考虑只允许打开 http/https 链接',
        detail: url,
        suggestion: '请使用以 http:// 或 https:// 开头的合法链接',
      })
    }
    try {
      await shell.openExternal(url)
    } catch (e) {
      throw createAppError('IO_ERROR', {
        message: '无法打开外部链接',
        detail: e instanceof Error ? e.message : String(e),
        suggestion: '请检查系统默认浏览器是否可用',
      })
    }
  })

  // ── M7 诊断包 / 日志目录 / 签名状态 ──
  add(CH.diagnosticsOpenLogsDir, async (c): Promise<void> => {
    if (!c.diagnostics) {
      throw createAppError('IO_ERROR', { message: '诊断服务未初始化' })
    }
    await c.diagnostics.openLogsDir()
  })

  add(
    CH.diagnosticsExportPackage,
    async (c, arg: never): Promise<DiagnosticsExportResult | null> => {
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
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) return null
      const target = normalizeDiagnosticsTarget(result.filePath)
      return c.diagnostics.exportTo(target)
    },
  )

  add(CH.appSignatureStatus, async (c): Promise<SignatureStatus> => {
    if (!c.signature) return { checked: false, signed: false, smartscreenNote: SMARTSCREEN_NOTE }
    try {
      return await c.signature.status()
    } catch (e) {
      // review 0.1.2 根治：签名检测失败是可预期降级路径 —— 兜底为未检测态，
      // 绝不冒泡成 UNKNOWN 把设置页整个打红
      c.logger.warn('signature status check degraded', { error: String(e) })
      return {
        checked: false,
        signed: false,
        detail: e instanceof Error ? e.message : String(e),
        smartscreenNote: SMARTSCREEN_NOTE,
      }
    }
  })
}
