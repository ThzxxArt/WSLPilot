import { z } from 'zod'

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Zod 4 解包：default / prefault / optional / nullable / pipe / branded。
 * 使用 `_zod.def` 的运行时类型串而不是版本易漂移的 `typeName`。
 */
function unwrap(schema: unknown): unknown {
  let s = schema
  for (let i = 0; i < 10; i++) {
    const def = (s as { _zod?: { def?: { type?: string } } } | null)?._zod?.def
    if (!def) return s
    switch (def.type) {
      case 'default':
      case 'prefault':
      case 'optional':
      case 'nullable':
      case 'branded':
        s = (def as { innerType?: unknown }).innerType
        continue
      case 'pipe':
        s = (def as { in?: unknown }).in
        continue
      default:
        return s
    }
  }
  return s
}

function defOf(schema: unknown): {
  type?: string
  shape?: Record<string, unknown>
  element?: unknown
  valueType?: unknown
} {
  return ((schema as { _zod?: { def?: Record<string, unknown> } } | null)?._zod?.def ?? {}) as {
    type?: string
    shape?: Record<string, unknown>
    element?: unknown
    valueType?: unknown
  }
}

/**
 * 递归清洗：保留合法字段，非法字段回退默认值。
 * 解决 schema.parse(fallback) 因单字段类型错误导致整体丢失用户配置的问题。
 */
export function sanitizeWithSchema<T extends z.ZodType>(
  schema: T,
  data: unknown,
  defaults: z.infer<T>,
): z.infer<T> {
  // 先整体试一次
  const result = schema.safeParse(data)
  if (result.success) return result.data as z.infer<T>

  const core = unwrap(schema)
  const def = defOf(core)

  // 对象类型：逐字段递归清洗
  if (def.type === 'object' && def.shape) {
    const source = (
      data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}
    ) as Record<string, unknown>
    const defaultObj = (
      defaults !== null && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : {}
    ) as Record<string, unknown>

    const out: Record<string, unknown> = {}
    for (const [key, fieldSchema] of Object.entries(def.shape)) {
      const fieldDefault = defaultObj[key]

      if (key in source && source[key] !== undefined) {
        out[key] = sanitizeWithSchema(fieldSchema as z.ZodType, source[key], fieldDefault as never)
      } else if (fieldDefault !== undefined) {
        out[key] = fieldDefault
      }
    }

    const retry = (core as z.ZodType).safeParse(out)
    if (retry.success) return retry.data as z.infer<T>
    // 逐字段清洗后仍不满足 schema：仅当 out「键面残缺」（默认对象有键而 out 为 undefined 缺键）
    // 才整对象回退默认值；否则返回 out —— 语义级 refine 失败（如 network.jsonc 重复 id）时
    // 数据本身完整，整对象回退会把用户全部配置清空（review 0.1.2 审计修复：宁可保留用户数据）
    if (defaults !== undefined && Object.keys(defaultObj).some((k) => out[k] === undefined)) {
      const fallback = (core as z.ZodType).safeParse(defaults)
      if (fallback.success) return fallback.data as z.infer<T>
    }
    return out as z.infer<T>
  }

  // 数组类型：逐项清洗；仍不合法的项丢弃（避免脏数据入库）
  if (def.type === 'array' && def.element) {
    const itemSchema = def.element as z.ZodType
    if (Array.isArray(data)) {
      const cleaned: unknown[] = []
      for (const item of data) {
        const sanitized = sanitizeWithSchema(itemSchema, item, undefined as never)
        const check = (unwrap(itemSchema) as z.ZodType).safeParse(sanitized)
        if (check.success) cleaned.push(check.data)
      }
      const retry = (core as z.ZodType).safeParse(cleaned)
      return (retry.success ? retry.data : cleaned) as z.infer<T>
    }
  }

  // Record 类型：逐键清洗，合法键保留、非法键丢弃（禁止整体回退丢用户数据 — review C2）
  if (def.type === 'record' && def.valueType) {
    const valueSchema = def.valueType as z.ZodType
    const source = (
      data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}
    ) as Record<string, unknown>
    const defaultObj = (
      defaults !== null && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : {}
    ) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source)) {
      if (FORBIDDEN.has(key) || value === undefined) continue
      const sanitized = sanitizeWithSchema(valueSchema, value, defaultObj[key] as never)
      const check = (unwrap(valueSchema) as z.ZodType).safeParse(sanitized)
      if (check.success) out[key] = check.data
    }
    const retry = (core as z.ZodType).safeParse(out)
    return (retry.success ? retry.data : out) as z.infer<T>
  }

  // 其他类型（literal/enum/union 等单值）：解析失败回退默认值（单字段，不伤及其他数据）
  return defaults
}
