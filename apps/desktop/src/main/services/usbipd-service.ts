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
  assertSafeDistroName,
  buildUsbipdArgs,
  createAppError,
  isElevationError,
  ELEVATION_SUGGESTION,
  parseUsbipdList,
  previewUsbipdCommand,
  USBIPD_INSTALL_COMMAND,
  type ElevationOpResult,
  type ElevationRequest,
  type UsbDevice,
  type UsbipdOp,
  type UsbipdStatus,
} from '@wslpilot/shared'
import { runTool, type Logger, type RunToolFn } from '@wslpilot/kit'
import type { TaskControl } from './task-runner'

/** 安装引导（与 shared/usbipd 同一命令，禁止另抄一份） */
export const USBIPD_INSTALL_HINT = USBIPD_INSTALL_COMMAND

export interface UsbipdServiceDeps {
  logger: Logger
  runTool?: RunToolFn
  /** 提权助手（M7）：bind/unbind 直接执行权限不足时改由独立提权进程执行（§14.3） */
  elevation?: { runOne(req: ElevationRequest): Promise<ElevationOpResult> }
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
  op: UsbipdOp | 'list',
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
  if (op === 'list') {
    // list 失败不该给 detach 语境的建议（review M-14）
    throw createAppError('TASK_FAILED', {
      message,
      detail: text.trim(),
      rawCommand,
      suggestion: '请确认 usbipd 服务正在运行（services.msc → USBIPD），或重新插拔设备后重试',
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

/** 参数不被识别（不同 usbipd 版本的 CLI 选项集不同） */
export function isUnknownOptionError(e: unknown): boolean {
  const detail =
    e && typeof e === 'object' && 'detail' in e
      ? String((e as { detail?: string }).detail ?? '')
      : ''
  const message = e instanceof Error ? e.message : ''
  return /unknown|unrecognized|invalid (option|argument)|unexpected|未知|无法识别/i.test(
    `${message}\n${detail}`,
  )
}

export function createUsbipdService(deps: UsbipdServiceDeps): UsbipdService {
  const logger = deps.logger
  const tool: RunToolFn = deps.runTool ?? runTool

  async function runOp(op: UsbipdOp, busId: string, distro?: string): Promise<void> {
    const id = assertSafeBusId(busId)
    const target = distro?.trim() ? assertSafeDistroName(distro) : undefined
    const args = buildUsbipdArgs(op, id, target)
    const rawCommand = previewUsbipdCommand(op, id, target)
    logger.info('usbipd op', { op, busId: id, distro: target })
    const r = await tool('usbipd.exe', args, { timeoutMs: 30_000 })
    if (r.code === 0) return
    const text = `${r.stderr}\n${r.stdout}`
    // bind / unbind 需要管理员权限：直接执行被拒 → 提权助手（一次 UAC；§14.3）
    if (isElevationError(text) && deps.elevation && (op === 'bind' || op === 'unbind')) {
      logger.info('usbipd requires elevation, delegating', { op, busId: id })
      const res = await deps.elevation.runOne({
        op: op === 'bind' ? 'usbipd.bind' : 'usbipd.unbind',
        params: { busId: id },
      })
      if (res.ok) return
      throw createAppError('PERMISSION_DENIED', {
        message: `usbipd ${op} 失败（${id}）：提权执行失败`,
        detail: `${res.stderr}\n${res.stdout}`.trim(),
        rawCommand,
        suggestion: ELEVATION_SUGGESTION,
      })
    }
    mapUsbipdFailure(r, rawCommand, `usbipd ${op} 失败（${id}）`, op)
  }

  return {
    async status(): Promise<UsbipdStatus> {
      const r = await tool('usbipd.exe', ['--version'], { timeoutMs: 10_000 })
      const text = `${r.stdout}\n${r.stderr}`.trim()
      if (r.code !== 0 && isToolMissing(text)) {
        return { installed: false, version: '' }
      }
      if (r.code !== 0) {
        // 已安装但调用失败（服务异常/超时等）：如实报告，绝不误导用户重装（review 根治）
        logger.warn('usbipd --version failed', { detail: text })
        return {
          installed: true,
          version: '',
          error: text.slice(0, 300) || `usbipd 退出码 ${r.code}`,
        }
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
        mapUsbipdFailure(r, 'usbipd.exe list', '读取 USB 设备列表失败', 'list')
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
      const id = assertSafeBusId(busId)
      const target = distro?.trim() ? assertSafeDistroName(distro) : undefined
      try {
        await runOp('attach', id, target)
      } catch (e) {
        // usbipd 各版本 CLI 选项集不同：`--distribution` 并非处处存在。
        // 直接失败会让「指定发行版附加」100% 不可用，退回默认发行版再试一次（review M-14 根治）。
        if (target && isUnknownOptionError(e)) {
          logger.warn('attach --distribution unsupported, retrying default distro', { busId: id })
          await runOp('attach', id, undefined)
          return
        }
        throw e
      }
    },

    async detach(busId) {
      await runOp('detach', busId)
    },
  }
}
