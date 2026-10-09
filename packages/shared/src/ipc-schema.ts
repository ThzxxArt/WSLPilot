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
}

/** 校验入参；通道约定：invoke 只传一个参数（对象或原始值） */
export function parseIpcArgs<T = unknown>(channel: string, args: unknown[]): T {
  const schema = IPC_SCHEMAS[channel]
  const value = args[0]
  if (!schema) return value as T
  return schema.parse(value) as T
}
