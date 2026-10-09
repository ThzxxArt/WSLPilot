import { parse as parseJsonc, modify, applyEdits, type ParseError, printParseErrorCode } from 'jsonc-parser'
import { createAppError } from '@wslpilot/shared'

export interface JsoncParseResult<T = unknown> {
  data: T | undefined
  errors: ParseError[]
  /** 格式化的错误信息（含行号） */
  errorMessage?: string
}

/** 解析 JSONC，容错注释与尾逗号；失败时返回错误位置 */
export function parseJsoncSafe<T = unknown>(text: string): JsoncParseResult<T> {
  const errors: ParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false }) as T

  if (errors.length > 0) {
    const first = errors[0]
    const line = text.slice(0, first.offset).split('\n').length
    return {
      data: undefined,
      errors,
      errorMessage: `${printParseErrorCode(first.error)}（第 ${line} 行，偏移 ${first.offset}）`,
    }
  }
  return { data, errors: [] }
}

/**
 * 最小编辑写回：仅改动目标路径，保留其余注释与格式。
 * path 示例：['general', 'accent']
 */
export function modifyJsonc(text: string, path: (string | number)[], value: unknown): string {
  const edits = modify(text, path, value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: '\n',
      keepLines: true,
    },
  })
  return applyEdits(text, edits)
}

export interface LeafPatch {
  path: (string | number)[]
  value: unknown
}

/** 把嵌套 patch 打平成叶子路径列表（数组整体作为一个叶子） */
export function collectLeafPaths(obj: unknown, prefix: (string | number)[] = []): LeafPatch[] {
  if (obj === undefined) return []
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return [{ path: prefix, value: obj }]
  }
  const results: LeafPatch[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === undefined) continue
    results.push(...collectLeafPaths(v, [...prefix, k]))
  }
  return results
}

/**
 * 对 JSONC 原文做嵌套补丁，逐叶子 modify，**保留叶子之外的用户注释**。
 * 注意：被替换的数组/对象整体作为叶子时，其内部注释会随整块替换丢失（设计书 §9.3「尽量」）。
 */
export function applyPatchJsonc(text: string, patch: Record<string, unknown>): string {
  const leaves = collectLeafPaths(patch)
  let out = text
  for (const { path, value } of leaves) {
    out = modifyJsonc(out, path, value)
  }
  return out
}

/** 整文件序列化（首次写入 / replace 场景，不保留注释） */
export function stringifyJsonc(value: unknown, header?: string): string {
  const body = JSON.stringify(value, null, 2)
  return header ? `// ${header}\n${body}\n` : `${body}\n`
}

export function parseOrThrow<T = unknown>(text: string, fileName: string): T {
  const result = parseJsoncSafe<T>(text)
  if (!result.data || result.errors.length > 0) {
    throw createAppError('CONFIG_INVALID', {
      message: `配置文件 ${fileName} 解析失败`,
      detail: result.errorMessage,
    })
  }
  return result.data
}
