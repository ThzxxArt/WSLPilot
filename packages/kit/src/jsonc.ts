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

/** 整文件序列化（首次写入 / replace 场景） */
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
