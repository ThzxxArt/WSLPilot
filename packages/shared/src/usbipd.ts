/**
 * USB 设备（M6 usbipd，可选）纯助手。
 * `usbipd list` 输出解析与命令构建主/渲染共享（设计书 §12.6）。
 */
import { formatCommand } from './commands'
import { createAppError } from './errors'
import type { UsbDevice, UsbipdOp, UsbipdState } from './types'

/** busid 形如 `1-2` / `2-1.3`（数字-数字[.数字…]） */
const BUSID_RE = /^\d{1,3}-\d{1,3}(\.\d{1,3})*$/

/** usbipd 安装命令（唯一事实源：服务层提示与界面引导共用） */
export const USBIPD_INSTALL_COMMAND = 'winget install usbipd --source winget'

export function assertSafeBusId(busId: unknown): string {
  const s = typeof busId === 'string' ? busId.trim() : ''
  const bad = (msg: string): never => {
    throw createAppError('CONFIG_INVALID', {
      message: msg,
      suggestion: 'BUSID 形如 `1-2` 或 `2-1.3`，请从设备列表中选择',
    })
  }
  if (!s || s.length > 40) bad('BUSID 非法（空或超长）')
  if (!BUSID_RE.test(s)) bad(`BUSID 非法：${s}`)
  return s
}

/** STATE 列 → 规范化状态 */
export function normalizeUsbipdState(raw: string): UsbipdState {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'not attached' || s === 'notattached') return 'not-attached'
  if (s === 'shared') return 'shared'
  if (s === 'attached') return 'attached'
  if (s === 'not shared' || s === 'notshared') return 'not-shared'
  return 'unknown'
}

/** 状态中文（唯一事实源） */
export function usbipdStateLabel(state: UsbipdState): string {
  switch (state) {
    case 'not-attached':
      return '未附加'
    case 'shared':
      return '已共享'
    case 'attached':
      return '已附加'
    case 'not-shared':
      return '未共享'
    default:
      return '未知'
  }
}

/**
 * 解析 `usbipd list` 输出。
 * 数据行：`BUSID  VID:PID  DEVICE…  STATE`；DEVICE 可含空格，STATE 固定为四个枚举词组。
 * 头部（Connected: / Persisted: / 列名）与空行一律跳过。
 */
export function parseUsbipdList(raw: string): UsbDevice[] {
  const out: UsbDevice[] = []
  const seen = new Set<string>()
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const m =
      /^(\d{1,3}-\d{1,3}(?:\.\d{1,3})*)\s+([0-9a-fA-F]{1,4}):([0-9a-fA-F]{1,4})\s+(.+?)\s+(Not attached|Not shared|Shared|Attached)\s*$/.exec(
        line.trim(),
      )
    if (!m) continue
    const busId = m[1]!
    if (seen.has(busId)) continue
    seen.add(busId)
    out.push({
      busId,
      vid: m[2]!.toLowerCase(),
      pid: m[3]!.toLowerCase(),
      description: m[4]!.trim(),
      state: normalizeUsbipdState(m[5]!),
    })
  }
  return out
}

/** usbipd 命令参数数组（不拼接用户输入进 shell） */
export function buildUsbipdArgs(op: UsbipdOp, busId: string, distro?: string): string[] {
  const id = assertSafeBusId(busId)
  switch (op) {
    case 'bind':
      return ['bind', '--busid', id]
    case 'unbind':
      return ['unbind', '--busid', id]
    case 'detach':
      return ['detach', '--busid', id]
    case 'attach': {
      const args = ['attach', '--wsl']
      const d = String(distro ?? '').trim()
      if (d) args.push('--distribution', d)
      args.push('--busid', id)
      return args
    }
    default:
      throw createAppError('CONFIG_INVALID', { message: `未知 usbipd 操作：${String(op)}` })
  }
}

/** 等价命令行（仅界面展示 / 任务日志，绝不用于执行） */
export function previewUsbipdCommand(op: UsbipdOp, busId: string, distro?: string): string {
  return formatCommand('usbipd.exe', buildUsbipdArgs(op, busId, distro))
}

/** 操作中文名（任务消息 / 确认框） */
export function usbipdOpLabel(op: UsbipdOp): string {
  switch (op) {
    case 'bind':
      return '绑定'
    case 'unbind':
      return '解除绑定'
    case 'attach':
      return '附加到 WSL'
    case 'detach':
      return '断开附加'
    default:
      return op
  }
}

/** 设备是否可绑定（未共享或已共享都可 bind/unbind 切换） */
export function canToggleShare(state: UsbipdState): boolean {
  return state === 'shared' || state === 'not-shared' || state === 'not-attached'
}

/** 设备是否可附加（仅已共享设备可 attach） */
export function canAttach(state: UsbipdState): boolean {
  return state === 'shared'
}

/** 设备是否可断开（仅已附加） */
export function canDetach(state: UsbipdState): boolean {
  return state === 'attached'
}
