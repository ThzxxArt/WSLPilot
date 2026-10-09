import { z } from 'zod'
import { CH } from './channels'

/**
 * 各 IPC 通道入参 zod schema（设计书 §8.2）。
 * router 在调用 handler 前统一 parse，失败抛结构化 AppError。
 */
export const nameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !s.trim().includes('..'), { message: '名称不能包含 ..' })

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** 嵌套 patch：拒绝原型污染键（z.custom 原样校验，避免 z.record 复制时丢掉 __proto__） */
export const patchSchema = z.custom<Record<string, unknown>>(
  (obj) => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false
    const keys = Object.getOwnPropertyNames(obj)
    return !keys.some((k) => FORBIDDEN_KEYS.has(k))
  },
  { message: 'patch 包含非法键' },
)

export const configKeySchema = z.enum(['settings', 'distros', 'actions', 'network', 'uiState', 'state'])

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

export const IPC_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [CH.distrosStart]: nameSchema,
  [CH.distrosTerminate]: nameSchema,
  [CH.distrosSetDefault]: nameSchema,
  [CH.registryDetail]: nameSchema,
  [CH.metaGet]: nameSchema,
  [CH.metricsSample]: nameSchema,

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
    shell: z.string().max(200).optional(),
    cwd: z.string().max(500).optional(),
    cols: z.number().int().min(2).max(500).default(80),
    rows: z.number().int().min(1).max(200).default(24),
  }),
  [CH.ptyInput]: z.object({
    ptyId: z.string().min(1),
    // 大粘贴分片；256KB 足够，超过由渲染层分片
    data: z.string().max(1024 * 256),
  }),
  [CH.ptyResize]: z.object({
    ptyId: z.string().min(1),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(200),
  }),
  [CH.ptyKill]: z.string().min(1),

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
  [CH.taskCancel]: z.string().min(1).max(200),

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
}

/** 校验入参；通道约定：invoke 只传一个参数（对象或原始值） */
export function parseIpcArgs<T = unknown>(channel: string, args: unknown[]): T {
  const schema = IPC_SCHEMAS[channel]
  const value = args[0]
  if (!schema) return value as T
  return schema.parse(value) as T
}
