import { z } from 'zod'

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

/** 解包 ZodDefault / ZodOptional / ZodNullable / ZodEffects / ZodBranded */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema as any
  for (let i = 0; i < 10; i++) {
    if (!s || typeof s !== 'object') return s
    const typeName = s._def?.typeName
    if (
      typeName === 'ZodDefault' ||
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodBranded'
    ) {
      s = s._def.innerType ?? s._def.schema
      continue
    }
    if (typeName === 'ZodEffects') {
      s = s._def.schema
      continue
    }
    break
  }
  return s
}

/**
 * 递归清洗：保留合法字段，非法字段回退默认值。
 * 解决 schema.parse(fallback) 因单字段类型错误导致整体丢失用户配置的问题。
 */
export function sanitizeWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  defaults: z.infer<T>,
): z.infer<T> {
  // 先整体试一次
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const core = unwrap(schema)

  // 对象类型：逐字段递归清洗
  if (core instanceof z.ZodObject) {
    const shape = core.shape as Record<string, z.ZodTypeAny>
    const source = (
      data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}
    ) as Record<string, unknown>
    const defaultObj = (
      defaults !== null && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : {}
    ) as Record<string, unknown>

    const out: Record<string, unknown> = {}
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const fieldDefault = defaultObj[key]

      if (key in source && source[key] !== undefined) {
        out[key] = sanitizeWithSchema(fieldSchema, source[key], fieldDefault as any)
      } else if (fieldDefault !== undefined) {
        out[key] = fieldDefault
      }
    }

    const retry = core.safeParse(out)
    return (retry.success ? retry.data : out) as z.infer<T>
  }

  // 数组类型：逐项清洗；仍不合法的项丢弃（避免脏数据入库）
  if (core instanceof z.ZodArray && Array.isArray(data)) {
    const itemSchema = core.element
    const cleaned: unknown[] = []
    for (const item of data) {
      const sanitized = sanitizeWithSchema(itemSchema, item, undefined as any)
      const check = unwrap(itemSchema).safeParse(sanitized)
      if (check.success) cleaned.push(check.data)
    }
    const retry = core.safeParse(cleaned)
    return (retry.success ? retry.data : cleaned) as z.infer<T>
  }

  // Record 类型：逐键清洗，合法键保留、非法键丢弃（禁止整体回退丢用户数据 — review C2）
  if (core instanceof z.ZodRecord) {
    const source = (
      data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}
    ) as Record<string, unknown>
    const defaultObj = (
      defaults !== null && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : {}
    ) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source)) {
      if (FORBIDDEN.has(key) || value === undefined) continue
      const sanitized = sanitizeWithSchema(core.valueSchema, value, defaultObj[key] as any)
      const check = unwrap(core.valueSchema).safeParse(sanitized)
      if (check.success) out[key] = check.data
    }
    const retry = core.safeParse(out)
    return (retry.success ? retry.data : out) as z.infer<T>
  }

  // 其他类型（literal/enum/union 等单值）：解析失败回退默认值（单字段，不伤及其他数据）
  return defaults
}
