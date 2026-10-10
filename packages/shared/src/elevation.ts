/**
 * 提权助手（ElevationHelper，设计书 §14.3）— 结构化请求契约。
 *
 * 铁律：Helper 只接受**结构化请求**（操作类型 + 参数），绝不接受任意命令行。
 * - 渲染层/服务层只能声明 `ElevationOp`（白名单）与该操作的参数
 * - `buildElevatedInvocation` 是 op → program/argv 的**唯一事实源**（参数数组，无 shell 拼接）
 * - 提权脚本二次校验 op 与 program 的对应关系（纵深防御）
 */
import { formatCommand } from './commands'
import { assertSafeDistroName, createAppError } from './errors'
import { assertSafeBusId } from './usbipd'
import { isValidAddress, buildPortProxyAddArgs, buildPortProxyDeleteArgs } from './network'
import { buildUsbipdArgs } from './usbipd'
import { ioPathSchema } from './ipc-schema'
import { z } from 'zod'

/** 提权操作白名单（唯一事实源） */
export const ELEVATION_OPS = [
  'netsh.portproxy.add',
  'netsh.portproxy.delete',
  'usbipd.bind',
  'usbipd.unbind',
  'wsl.move',
  'wsl.install',
  'wsl.setVersion',
] as const

export type ElevationOp = (typeof ELEVATION_OPS)[number]

/** 每个 op 允许调用的程序（提权脚本二次校验用） */
export const ELEVATION_PROGRAMS: Record<ElevationOp, string> = {
  'netsh.portproxy.add': 'netsh.exe',
  'netsh.portproxy.delete': 'netsh.exe',
  'usbipd.bind': 'usbipd.exe',
  'usbipd.unbind': 'usbipd.exe',
  'wsl.move': 'wsl.exe',
  'wsl.install': 'wsl.exe',
  'wsl.setVersion': 'wsl.exe',
}

/** 提权操作的展示名（任务日志 / 确认框） */
export const ELEVATION_OP_LABEL: Record<ElevationOp, string> = {
  'netsh.portproxy.add': '应用端口转发规则',
  'netsh.portproxy.delete': '移除端口转发规则',
  'usbipd.bind': '共享 USB 设备',
  'usbipd.unbind': '取消共享 USB 设备',
  'wsl.move': '迁移发行版磁盘',
  'wsl.install': '安装 WSL 发行版',
  'wsl.setVersion': '转换 WSL 版本',
}

/** 结构化参数（各 op 的形状由 schema 校验） */
export type ElevationParams = Record<string, string | number | boolean>

export interface ElevationRequest {
  op: ElevationOp
  params: ElevationParams
}

/** Helper 执行结果（result.json） */
export interface ElevationResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  /** 用户取消了 UAC 弹窗 */
  canceled: boolean
  /** 请求未执行原因（校验失败等） */
  error?: string
}

const distroField = z
  .string()
  .min(1)
  .max(200)
  .superRefine((s, ctx) => {
    try {
      assertSafeDistroName(s)
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : '非法的发行版名称',
      })
    }
  })

const portField = z.number().int().min(1).max(65535)

/** 各 op 的参数 schema（IPC 边界 / 服务层共用） */
export const ELEVATION_PARAM_SCHEMAS: Record<ElevationOp, z.ZodTypeAny> = {
  'netsh.portproxy.add': z
    .object({
      listenAddress: z.string().refine(isValidAddress, '监听地址无效'),
      listenPort: portField,
      connectAddress: z.string().refine(isValidAddress, '转发地址无效'),
      connectPort: portField,
    })
    .strict(),
  'netsh.portproxy.delete': z
    .object({
      listenAddress: z.string().refine(isValidAddress, '监听地址无效'),
      listenPort: portField,
    })
    .strict(),
  'usbipd.bind': z
    .object({
      busId: z.string().superRefine((s, ctx) => {
        try {
          assertSafeBusId(s)
        } catch (e) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: e instanceof Error ? e.message : 'BUSID 非法',
          })
        }
      }),
    })
    .strict(),
  'usbipd.unbind': z
    .object({
      busId: z.string().superRefine((s, ctx) => {
        try {
          assertSafeBusId(s)
        } catch (e) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: e instanceof Error ? e.message : 'BUSID 非法',
          })
        }
      }),
    })
    .strict(),
  'wsl.move': z
    .object({
      name: distroField,
      path: ioPathSchema,
    })
    .strict(),
  'wsl.install': z
    .object({
      name: distroField.optional(),
    })
    .strict(),
  'wsl.setVersion': z
    .object({
      name: distroField,
      version: z.union([z.literal(1), z.literal(2)]),
    })
    .strict(),
}

export function isElevationOp(value: unknown): value is ElevationOp {
  return typeof value === 'string' && (ELEVATION_OPS as readonly string[]).includes(value)
}

/**
 * 校验结构化请求；失败抛 CONFIG_INVALID。
 * 任何"想执行任意命令"的请求都到不了 Helper。
 */
export function validateElevationRequest(input: unknown): ElevationRequest {
  const bad = (msg: string): never => {
    throw createAppError('CONFIG_INVALID', {
      message: msg,
      suggestion: '提权助手只接受白名单内的结构化操作（操作类型 + 参数）',
    })
  }
  if (input === null || typeof input !== 'object') return bad('提权请求必须是对象')
  const req = input as Record<string, unknown>
  const op = req.op
  if (!isElevationOp(op)) return bad(`未知的提权操作：${String(op)}`)
  const schema = ELEVATION_PARAM_SCHEMAS[op]
  const parsed = schema.safeParse(req.params ?? {})
  if (!parsed.success) {
    return bad(`提权参数非法（${op}）：${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  return { op, params: parsed.data as ElevationParams }
}

export interface ElevatedInvocation {
  program: string
  args: string[]
  /** 等价命令行（展示 / 日志用） */
  preview: string
}

/**
 * op + params → program/argv（唯一事实源）。
 * 一律参数数组，杜绝字符串拼接；提权脚本按同一映射二次校验。
 */
export function buildElevatedInvocation(req: ElevationRequest): ElevatedInvocation {
  const validated = validateElevationRequest(req)
  const program = ELEVATION_PROGRAMS[validated.op]
  let args: string[]
  switch (validated.op) {
    case 'netsh.portproxy.add':
      args = buildPortProxyAddArgs({
        listenAddress: validated.params.listenAddress as string,
        listenPort: validated.params.listenPort as number,
        connectAddress: validated.params.connectAddress as string,
        connectPort: validated.params.connectPort as number,
      })
      break
    case 'netsh.portproxy.delete':
      args = buildPortProxyDeleteArgs({
        listenAddress: validated.params.listenAddress as string,
        listenPort: validated.params.listenPort as number,
      })
      break
    case 'usbipd.bind':
      args = buildUsbipdArgs('bind', validated.params.busId as string)
      break
    case 'usbipd.unbind':
      args = buildUsbipdArgs('unbind', validated.params.busId as string)
      break
    case 'wsl.move':
      args = [
        '--manage',
        validated.params.name as string,
        '--move',
        validated.params.path as string,
      ]
      break
    case 'wsl.install':
      args = validated.params.name
        ? ['--install', '-d', validated.params.name as string]
        : ['--install']
      break
    case 'wsl.setVersion':
      args = ['--set-version', validated.params.name as string, String(validated.params.version)]
      break
    default: {
      const never: never = validated.op
      throw createAppError('CONFIG_INVALID', { message: `未知的提权操作：${String(never)}` })
    }
  }
  return { program, args, preview: formatCommand(program, args) }
}

/** Helper 请求文件载荷（写入临时 JSON，供提权进程读取）— 支持批量，合并 UAC 弹窗 */
export interface ElevationHelperOp {
  op: ElevationOp
  program: string
  args: string[]
}

export interface ElevationHelperPayload {
  v: 1
  ops: ElevationHelperOp[]
}

/** 单个操作的执行结果 */
export interface ElevationOpResult {
  op: ElevationOp
  ok: boolean
  code: number
  stdout: string
  stderr: string
  /** 请求未执行原因（校验失败等） */
  error?: string
}

/** 提权运行结果（result.json） */
export interface ElevationRunResult {
  /** 用户取消了 UAC 弹窗 */
  canceled: boolean
  /** 整体失败原因（脚本未执行 / 校验失败） */
  error?: string
  results: ElevationOpResult[]
}

/**
 * 结构化请求 → Helper 载荷（唯一事实源：op → program/argv）。
 * 一次调用生成一个载荷；批量操作合并为一次 UAC 提权会话。
 */
export function buildElevationHelperPayload(
  requests: readonly ElevationRequest[],
): ElevationHelperPayload {
  if (requests.length === 0) {
    throw createAppError('CONFIG_INVALID', { message: '提权请求不能为空' })
  }
  return {
    v: 1,
    ops: requests.map((req) => {
      const inv = buildElevatedInvocation(req)
      return { op: validateElevationRequest(req).op, program: inv.program, args: inv.args }
    }),
  }
}

/** 提权失败时的统一建议文案（界面 / 日志共用） */
export const ELEVATION_SUGGESTION =
  '可点击「以管理员身份重试」，或在管理员终端中执行等价命令（UAC 弹窗中选择「是」）'

/**
 * 提权类失败识别（中英文 Windows 报错）。
 * 直接执行被拒绝时，服务层改由提权助手执行（设计书 §14.3）。
 */
export function isElevationError(text: string): boolean {
  return /requires?\s+elevation|elevat|run as administrator|administrator\s+privileges|请求的操作需要提升|需要提升|以管理员|拒绝访问|access is denied|permission denied/i.test(
    text,
  )
}
