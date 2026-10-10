/**
 * USB 设备服务（M6 usbipd，可选）— UsbipdService（设计书 §12.6）。
 * 铁律：
 * - 只封装 `usbipd.exe` 官方子命令（list / bind / unbind / attach / detach），参数数组化
 * - BUSID 严格白名单校验（`1-2` / `2-1.3`），渲染层无法注入任意参数
 * - usbipd 未安装时给出安装引导（winget install usbipd），不阻断其它功能
 * - bind / unbind 需要管理员权限 → PERMISSION_DENIED + 等价命令行
 */
import {
  assertSafeBusId,
  buildUsbipdArgs,
  createAppError,
  parseUsbipdList,
  previewUsbipdCommand,
  USBIPD_INSTALL_COMMAND,
  type UsbDevice,
  type UsbipdOp,
  type UsbipdStatus,
} from '@wslpilot/shared'
import { runTool, type Logger, type RunToolFn } from '@wslpilot/kit'
import type { TaskControl } from './task-runner'
import { isElevationError } from './network-service'

/** 安装引导（与 shared/usbipd 同一命令，禁止另抄一份） */
export const USBIPD_INSTALL_HINT = USBIPD_INSTALL_COMMAND

export interface UsbipdServiceDeps {
  logger: Logger
  runTool?: RunToolFn
}

export interface UsbipdService {
  status(): Promise<UsbipdStatus>
  list(): Promise<UsbDevice[]>
  bind(busId: string, ctl: TaskControl): Promise<void>
  unbind(busId: string, ctl: TaskControl): Promise<void>
  attach(busId: string, distro?: string): Promise<void>
  detach(busId: string): Promise<void>
}

/** 工具缺失识别（ENOENT / 不是内部或外部命令） */
export function isToolMissing(text: string): boolean {
  return /ENOENT|not recognized|不是内部或外部命令|找不到.*usbipd|no such file/i.test(text)
}

function mapUsbipdFailure(
  r: { stdout: string; stderr: string; code: number },
  rawCommand: string,
  message: string,
  op: UsbipdOp,
): never {
  const text = `${r.stderr}\n${r.stdout}`
  if (isToolMissing(text)) {
    throw createAppError('TASK_FAILED', {
      message: '未安装 usbipd',
      detail: text.trim(),
      rawCommand,
      suggestion: `请先安装 usbipd：${USBIPD_INSTALL_HINT}`,
    })
  }
  if (isElevationError(text)) {
    throw createAppError('PERMISSION_DENIED', {
      message: `${message}：需要管理员权限`,
      detail: text.trim(),
      rawCommand,
      suggestion: '请以管理员身份运行 WSLPilot，或在管理员终端中执行上述命令',
    })
  }
  throw createAppError('TASK_FAILED', {
    message,
    detail: text.trim(),
    rawCommand,
    suggestion:
      op === 'attach'
        ? '附加需要 usbipd 2.0+（`usbipd attach --wsl`），且设备必须处于「已共享」状态'
        : '请确认设备仍连接在本机后重试',
  })
}

export function createUsbipdService(deps: UsbipdServiceDeps): UsbipdService {
  const logger = deps.logger
  const tool: RunToolFn = deps.runTool ?? runTool

  async function runOp(op: UsbipdOp, busId: string, distro?: string): Promise<void> {
    const id = assertSafeBusId(busId)
    const args = buildUsbipdArgs(op, id, distro)
    const rawCommand = previewUsbipdCommand(op, id, distro)
    logger.info('usbipd op', { op, busId: id, distro })
    const r = await tool('usbipd.exe', args, { timeoutMs: 30_000 })
    if (r.code !== 0) mapUsbipdFailure(r, rawCommand, `usbipd ${op} 失败（${id}）`, op)
  }

  return {
    async status(): Promise<UsbipdStatus> {
      const r = await tool('usbipd.exe', ['--version'], { timeoutMs: 10_000 })
      const text = `${r.stdout}\n${r.stderr}`.trim()
      if (r.code !== 0 && isToolMissing(text)) {
        return { installed: false, version: '' }
      }
      if (r.code !== 0) {
        logger.warn('usbipd --version failed', { detail: text })
        return { installed: false, version: '' }
      }
      // 形如 `usbipd-win 2.4.1` 或 `2.4.1`
      const version = /(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] ?? text.split(/\r?\n/)[0]!.trim()
      return { installed: true, version }
    },

    async list(): Promise<UsbDevice[]> {
      const r = await tool('usbipd.exe', ['list'], { timeoutMs: 15_000 })
      const text = `${r.stdout}\n${r.stderr}`
      if (r.code !== 0 && isToolMissing(text)) {
        throw createAppError('TASK_FAILED', {
          message: '未安装 usbipd，无法列出 USB 设备',
          detail: text.trim(),
          rawCommand: 'usbipd.exe list',
          suggestion: `请先安装 usbipd：${USBIPD_INSTALL_HINT}`,
        })
      }
      if (r.code !== 0) {
        mapUsbipdFailure(r, 'usbipd.exe list', '读取 USB 设备列表失败', 'bind')
      }
      return parseUsbipdList(r.stdout)
    },

    async bind(busId, ctl) {
      const id = assertSafeBusId(busId)
      ctl.log(`$ ${previewUsbipdCommand('bind', id)}`)
      ctl.report(null, `绑定设备 ${id}`)
      await runOp('bind', id)
      ctl.log(`已绑定 ${id}`)
      ctl.report(100, `已绑定 ${id}`)
    },

    async unbind(busId, ctl) {
      const id = assertSafeBusId(busId)
      ctl.log(`$ ${previewUsbipdCommand('unbind', id)}`)
      ctl.report(null, `解除绑定 ${id}`)
      await runOp('unbind', id)
      ctl.log(`已解除绑定 ${id}`)
      ctl.report(100, `已解除绑定 ${id}`)
    },

    async attach(busId, distro) {
      await runOp('attach', busId, distro)
    },

    async detach(busId) {
      await runOp('detach', busId)
    },
  }
}
