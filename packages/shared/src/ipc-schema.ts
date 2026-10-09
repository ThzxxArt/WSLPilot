import { z } from 'zod'
import { CH, type ChannelName } from './channels'
import { assertSafeDistroName } from './errors'

/**
 * 各 IPC 通道入参 zod schema（设计书 §8.2）。
 * router 在调用 handler 前统一 parse，失败抛结构化 AppError。
 */
/**
 * 发行版名校验（与执行边界 assertSafeDistroName 同一规则 — review M3）。
 * IPC 边界与执行边界必须一致，否则元数据成为"孤儿"。
 */
export const nameSchema = z
  .string()
  .trim()
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

/** 会话/任务 id：非空 + 长度上限 */
export const idSchema = z.string().min(1).max(200)

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 20 || value === null || typeof value !== 'object') return false
  const keys = Object.getOwnPropertyNames(value)
  if (keys.some((k) => FORBIDDEN_KEYS.has(k))) return true
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (hasForbiddenKey(v, depth + 1)) return true
  }
  return false
}

/** 嵌套 patch：递归拒绝原型污染键（含数组元素 — review M2） */
export const patchSchema = z.custom<Record<string, unknown>>(
  (obj) => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false
    return !hasForbiddenKey(obj)
  },
  { message: 'patch 包含非法键' },
)

export const configKeySchema = z.enum([
  'settings',
  'distros',
  'actions',
  'network',
  'uiState',
  'state',
])

/** IO 路径：拒绝控制字符与 NUL，长度受限（设计书 §14.2 路径校验） */
export const ioPathSchema = z
  .string()
  .min(1)
  .max(1024)
  // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), { message: '路径包含非法控制字符' })
  .refine((s) => s.trim().length > 0, { message: '路径不能为空' })

export const fileFilterSchema = z.object({
  name: z.string().min(1).max(100),
  extensions: z.array(z.string().min(1).max(20)).min(1).max(20),
})

export const metaPayloadSchema = z.object({
  name: nameSchema,
  alias: z.string().default(''),
  tags: z.array(z.string()).default([]),
  color: z.string().default(''),
  icon: z.string().default(''),
  note: z.string().default(''),
  startupCwd: z.string().default('~'),
  pinned: z.boolean().default(false),
  quickActions: z.array(z.string()).default([]),
})

/** 拒绝控制字符的字符串（max 由调用方先约束，refine 后无链式方法） */
function noControl(maxLen: number) {
  return (
    z
      .string()
      .max(maxLen)
      // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), { message: '包含非法控制字符' })
  )
}

export const IPC_SCHEMAS: Partial<Record<ChannelName, z.ZodTypeAny>> = {
  [CH.distrosStart]: nameSchema,
  [CH.distrosTerminate]: nameSchema,
  [CH.distrosSetDefault]: nameSchema,
  // 契约先行：M5/M6/M7 通道也必须有 schema，实现 handler 前不留校验缺口
  [CH.distrosSetVersion]: z.object({
    name: nameSchema,
    version: z.union([z.literal(1), z.literal(2)]),
  }),
  [CH.distrosUnregister]: nameSchema,
  [CH.distrosInstall]: z.object({
    name: nameSchema.optional(),
    source: z.enum(['store', 'web']).default('store'),
  }),
  [CH.registryDetail]: nameSchema,
  [CH.metaGet]: nameSchema,
  // '*' 是全局概览保留键，其余必须是合法发行版名
  [CH.metricsSample]: z.union([nameSchema, z.literal('*')]),

  [CH.configGet]: configKeySchema,
  [CH.configSet]: z.object({
    fileKey: configKeySchema,
    patch: patchSchema,
  }),
  [CH.configOpenExternal]: configKeySchema,
  [CH.configResolveConflict]: z.object({
    fileKey: configKeySchema,
    action: z.enum(['reload', 'overwrite', 'ignore']),
  }),

  [CH.metaSet]: metaPayloadSchema,

  // PTY
  [CH.ptyCreate]: z.object({
    distro: nameSchema,
    shell: noControl(200).optional(),
    cwd: noControl(500).optional(),
    cols: z.number().int().min(2).max(500).default(80),
    rows: z.number().int().min(1).max(200).default(24),
  }),
  [CH.ptyInput]: z.object({
    ptyId: idSchema,
    // 大粘贴分片；256KB 足够，超过由渲染层分片
    data: z.string().max(1024 * 256),
  }),
  [CH.ptyResize]: z.object({
    ptyId: idSchema,
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(200),
  }),
  [CH.ptyKill]: idSchema,

  // IO（M4 备份迁移）
  [CH.ioExport]: z.object({
    name: nameSchema,
    path: ioPathSchema,
    format: z.enum(['tar', 'vhd']),
  }),
  [CH.ioImport]: z.object({
    name: nameSchema,
    // 就地导入（inPlace）时允许为空；归档导入由 IoService 再校验非空
    installPath: ioPathSchema.or(z.literal('')),
    archivePath: ioPathSchema,
    format: z.enum(['tar', 'vhd']),
    version: z.union([z.literal(1), z.literal(2)]).default(2),
    inPlace: z.boolean().default(false),
  }),
  [CH.ioMove]: z.object({
    name: nameSchema,
    path: ioPathSchema,
    terminateFirst: z.boolean().default(false),
  }),
  [CH.ioListBackups]: z
    .object({
      dir: ioPathSchema.optional(),
    })
    .default({}),
  [CH.ioCleanupBackups]: z
    .object({
      dir: ioPathSchema.optional(),
      keep: z.number().int().min(1).max(50).default(5),
    })
    .default({}),
  [CH.taskCancel]: idSchema,

  // 系统文件对话框
  [CH.appPickDirectory]: z
    .object({
      defaultPath: ioPathSchema.optional(),
    })
    .default({}),
  [CH.appPickSaveFile]: z
    .object({
      defaultPath: ioPathSchema.optional(),
      suggestedName: z.string().max(255).optional(),
      filters: z.array(fileFilterSchema).max(10).optional(),
    })
    .default({}),
  [CH.appPickOpenFile]: z
    .object({
      defaultPath: ioPathSchema.optional(),
      filters: z.array(fileFilterSchema).max(10).optional(),
    })
    .default({}),
  [CH.appOpenPath]: ioPathSchema,

  // wsl.conf（M5）
  [CH.wslconfRead]: nameSchema,
  [CH.wslconfWrite]: z.object({
    name: nameSchema,
    content: z.string().max(64 * 1024),
  }),

  // 发行版内文件（M5）：路径经 wsl.localhost 桥，一律拒绝控制字符
  [CH.fsReadDir]: z.object({
    distro: nameSchema,
    path: noControl(1024),
  }),
  [CH.fsRead]: z.object({
    distro: nameSchema,
    path: noControl(1024),
  }),
  [CH.fsWrite]: z.object({
    distro: nameSchema,
    path: noControl(1024),
    data: z.string().max(4 * 1024 * 1024),
  }),
  [CH.fsRevealInExplorer]: z.object({
    distro: nameSchema,
    path: noControl(1024),
  }),

  // 自定义动作（M5）：只允许执行配置中声明的 actionId
  [CH.actionRun]: z.object({
    actionId: z.string().min(1).max(100),
    distro: nameSchema.optional(),
  }),

  // 网络（M6）
  [CH.networkApply]: z.string().min(1).max(100),
}

/** 校验入参；通道约定：invoke 只传一个参数（对象或原始值） */
export function parseIpcArgs<T = unknown>(channel: string, args: unknown[]): T {
  const schema = IPC_SCHEMAS[channel as ChannelName]
  const value = args[0]
  // 多余参数静默丢弃会掩盖调用方 bug（review m2）——显式拒绝
  if (args.length > 1) {
    throw new Error(`通道 ${channel} 只接受 1 个参数，收到 ${args.length} 个`)
  }
  if (!schema) return value as T
  return schema.parse(value) as T
}
