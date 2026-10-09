import { describeError, formatErrorLine, type AppError } from '@wslpilot/shared'

export { describeError, formatErrorLine }
export type { AppError }

/**
 * 统一错误提取（review C1）。
 * 禁止在消费端写 `e instanceof Error ? e.message : '...'`：
 * store 抛出的 AppError 是纯对象，instanceof 恒 false，会把真实原因吞掉。
 */
export function errorMessage(e: unknown, fallback = '操作失败'): string {
  return describeError(e, fallback).message
}

/** message + suggestion 单行文案 */
export function errorLine(e: unknown, fallback = '操作失败'): string {
  return formatErrorLine(e, fallback)
}
