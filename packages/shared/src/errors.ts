/** 结构化应用错误 — 面向用户可读，附带建议操作 */
export interface AppError {
  code: ErrorCode
  message: string
  detail?: string
  rawCommand?: string
  recoverable: boolean
  suggestion?: string
}

export type ErrorCode =
  | 'WSL_NOT_INSTALLED'
  | 'WSL_NOT_FOUND'
  | 'DISTRO_RUNNING'
  | 'DISTRO_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'CONFIG_INVALID'
  | 'CONFIG_CONFLICT'
  | 'IO_ERROR'
  | 'TASK_CANCELED'
  | 'TASK_FAILED'
  | 'UNKNOWN'

export class WslPilotError extends Error implements AppError {
  readonly code: ErrorCode
  readonly detail?: string
  readonly rawCommand?: string
  readonly recoverable: boolean
  readonly suggestion?: string

  constructor(init: AppError) {
    super(init.message)
    this.name = 'WslPilotError'
    this.code = init.code
    this.detail = init.detail
    this.rawCommand = init.rawCommand
    this.recoverable = init.recoverable
    this.suggestion = init.suggestion
  }

  toJSON(): AppError {
    return {
      code: this.code,
      message: this.message,
      detail: this.detail,
      rawCommand: this.rawCommand,
      recoverable: this.recoverable,
      suggestion: this.suggestion,
    }
  }
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e && 'recoverable' in e
}

/** 错误码 → 默认中文文案与建议 */
export const ERROR_CATALOG: Record<
  ErrorCode,
  { message: string; suggestion?: string; recoverable: boolean }
> = {
  WSL_NOT_INSTALLED: {
    message: '系统未启用 WSL',
    suggestion: '点击「一键安装 WSL」或运行 wsl --install',
    recoverable: true,
  },
  WSL_NOT_FOUND: {
    message: '找不到 wsl.exe',
    suggestion: '请检查 PATH 环境变量中是否包含 WSL 安装路径',
    recoverable: true,
  },
  DISTRO_RUNNING: {
    message: '该发行版正在运行',
    suggestion: '请先终止（terminate）该发行版后再操作',
    recoverable: true,
  },
  DISTRO_NOT_FOUND: {
    message: '找不到指定的发行版',
    suggestion: '请刷新发行版列表后重试',
    recoverable: true,
  },
  PERMISSION_DENIED: {
    message: '需要管理员权限',
    suggestion: '将通过提权助手完成此操作，请在 UAC 弹窗中确认',
    recoverable: true,
  },
  CONFIG_INVALID: {
    message: '配置文件格式有误',
    suggestion: '请根据行号提示修正配置后重试',
    recoverable: true,
  },
  CONFIG_CONFLICT: {
    message: '配置文件已被外部修改',
    suggestion: '请选择「重载」「覆盖」或「对比」以解决冲突',
    recoverable: true,
  },
  IO_ERROR: {
    message: '文件读写失败',
    recoverable: true,
  },
  TASK_CANCELED: {
    message: '任务已取消',
    recoverable: true,
  },
  TASK_FAILED: {
    message: '任务执行失败',
    recoverable: true,
  },
  UNKNOWN: {
    message: '发生未知错误',
    recoverable: true,
  },
}

export function createAppError(code: ErrorCode, overrides: Partial<AppError> = {}): WslPilotError {
  const base = ERROR_CATALOG[code]
  return new WslPilotError({
    code,
    message: overrides.message ?? base.message,
    detail: overrides.detail,
    rawCommand: overrides.rawCommand,
    recoverable: overrides.recoverable ?? base.recoverable,
    suggestion: overrides.suggestion ?? base.suggestion,
  })
}

/** IPC 错误序列化前缀 */
export const IPC_ERROR_PREFIX = 'WSLPILOT:'

/** 主进程抛出 IPC 错误（message 内嵌 AppError JSON） */
export function serializeIpcError(e: unknown): Error {
  let appErr: AppError
  if (e && typeof e === 'object' && 'code' in e && 'message' in e && 'recoverable' in e) {
    appErr = e as AppError
  } else {
    const detail =
      e instanceof Error
        ? `${e.name}: ${e.message}`
        : typeof e === 'string'
          ? e
          : (() => {
              try {
                return JSON.stringify(e)
              } catch {
                return String(e)
              }
            })()
    appErr = createAppError('UNKNOWN', { detail }).toJSON()
  }
  return new Error(`${IPC_ERROR_PREFIX}${JSON.stringify(appErr)}`)
}

/**
 * 从 invoke reject / catch 结果还原 AppError。
 * Electron 真实 reject 形态为：
 *   Error invoking remote method 'channel': Error: WSLPILOT:{...}
 * 因此必须 indexOf 而不是 startsWith。
 */
export function deserializeIpcError(e: unknown): AppError | null {
  const raw =
    e instanceof Error
      ? e.message
      : typeof e === 'string'
        ? e
        : (() => {
            try {
              return JSON.stringify(e)
            } catch {
              return ''
            }
          })()

  const idx = raw.indexOf(IPC_ERROR_PREFIX)
  if (idx >= 0) {
    const payload = raw.slice(idx + IPC_ERROR_PREFIX.length)
    // 直接解析
    try {
      return validateAppError(JSON.parse(payload))
    } catch {
      /* fallthrough */
    }
    // 兼容 JSON 后还有尾巴（Error stack 等）：截取首个 { 到最后一个 }
    const start = payload.indexOf('{')
    const end = payload.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return validateAppError(JSON.parse(payload.slice(start, end + 1)))
      } catch {
        return null
      }
    }
    return null
  }
  if (e && typeof e === 'object' && 'code' in e && 'message' in e && 'recoverable' in e) {
    return validateAppError(e)
  }
  return null
}

const ERROR_CODES = new Set<string>(Object.keys(ERROR_CATALOG))

/**
 * 反序列化结果结构校验（review M9）：畸形/伪造 payload 不可信，拒绝后走 UNKNOWN 兜底。
 */
function validateAppError(value: unknown): AppError | null {
  if (value === null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.code !== 'string' || !ERROR_CODES.has(v.code)) return null
  if (typeof v.message !== 'string' || v.message === '') return null
  if (typeof v.recoverable !== 'boolean') return null
  return {
    code: v.code as ErrorCode,
    message: v.message,
    detail: typeof v.detail === 'string' ? v.detail : undefined,
    rawCommand: typeof v.rawCommand === 'string' ? v.rawCommand : undefined,
    recoverable: v.recoverable,
    suggestion: typeof v.suggestion === 'string' ? v.suggestion : undefined,
  }
}

/** 任意 catch 结果 → 用户可读 AppError */
export function toAppError(e: unknown): AppError {
  return (
    deserializeIpcError(e) ??
    createAppError('UNKNOWN', {
      detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    }).toJSON()
  )
}

/**
 * 统一的用户可读错误提取（review C1）。
 * 消费端禁止 `e instanceof Error ? e.message : '...'`——AppError 是纯对象，
 * instanceof 恒 false 会把真实原因吞掉。一律用本函数。
 */
export function describeError(
  e: unknown,
  fallback = '操作失败',
): { message: string; suggestion?: string } {
  if (isAppError(e)) {
    return {
      message: e.message || fallback,
      suggestion: e.suggestion,
    }
  }
  if (e instanceof Error && e.message) {
    return { message: e.message }
  }
  if (typeof e === 'string' && e) {
    return { message: e }
  }
  return { message: fallback }
}

/** 展示用单行文案：message + suggestion */
export function formatErrorLine(e: unknown, fallback = '操作失败'): string {
  const { message, suggestion } = describeError(e, fallback)
  return suggestion ? `${message} — ${suggestion}` : message
}

/**
 * 发行版名称安全校验（执行边界统一入口）。
 * 允许空格/中文/中划线/点/下划线；拒绝控制字符、`..`、Windows 非法文件名字符。
 */
export function assertSafeDistroName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) {
    throw createAppError('DISTRO_NOT_FOUND', { message: '发行版名称不能为空' })
  }
  // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
  if (/[\u0000-\u001f\u007f]/.test(n) || n.includes('..')) {
    throw createAppError('DISTRO_NOT_FOUND', { message: `非法的发行版名称：${n}` })
  }
  if (/[\\/:*?"<>|]/.test(n)) {
    throw createAppError('DISTRO_NOT_FOUND', { message: `非法的发行版名称：${n}` })
  }
  return n
}
