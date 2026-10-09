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
    patch: z.record(z.unknown()).or(z.object({}).passthrough()),
  }),
  [CH.configOpenExternal]: configKeySchema,
  [CH.configResolveConflict]: z.object({
    fileKey: configKeySchema,
    action: z.enum(['reload', 'overwrite', 'ignore']),
  }),

  [CH.metaSet]: metaPayloadSchema,
}

/** 校验入参；单参通道传单值，多参通道传对象 */
export function parseIpcArgs<T = unknown>(channel: string, args: unknown[]): T {
  const schema = IPC_SCHEMAS[channel]
  if (!schema) {
    // 无 schema 的通道（如 void invoke）直接透传第一个参
    return args[0] as T
  }
  const value = args.length === 1 ? args[0] : args[0]
  return schema.parse(value) as T
}
