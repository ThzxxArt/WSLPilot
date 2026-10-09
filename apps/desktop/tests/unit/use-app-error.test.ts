import { describe, it, expect } from 'vitest'
import {
  errorMessage,
  errorLine,
  describeError,
  formatErrorLine,
} from '../../src/renderer/composables/useAppError'

describe('useAppError', () => {
  it('AppError 纯对象提取 message/suggestion（禁 instanceof 误判）', () => {
    const appErr = {
      code: 'IO_ERROR',
      message: '写入失败',
      suggestion: '检查磁盘',
      recoverable: true,
    }
    expect(errorMessage(appErr)).toBe('写入失败')
    expect(errorLine(appErr)).toBe('写入失败 — 检查磁盘')
  })

  it('Error 实例与字符串与兜底', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(null, '操作失败')).toBe('操作失败')
    expect(errorLine(new Error('boom'))).toBe('boom')
  })

  it('describeError / formatErrorLine 与 wrapper 一致', () => {
    const e = { code: 'X', message: 'm', recoverable: true }
    expect(describeError(e)).toEqual({ message: 'm', suggestion: undefined })
    expect(formatErrorLine(e, 'fb')).toBe('m')
    expect(formatErrorLine(null, 'fb')).toBe('fb')
  })
})
