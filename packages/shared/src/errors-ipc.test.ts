import { describe, it, expect } from 'vitest'
import {
  serializeIpcError,
  deserializeIpcError,
  toAppError,
  createAppError,
  isAppError,
} from '../src/errors'

describe('IPC 错误序列化协议', () => {
  it('serialize → deserialize 往返还原 AppError', () => {
    const original = createAppError('CONFIG_INVALID', {
      message: '配置坏了',
      detail: '第 3 行',
      suggestion: '去修一下',
    }).toJSON()

    const err = serializeIpcError(original)
    expect(err).toBeInstanceOf(Error)

    const restored = deserializeIpcError(err)
    expect(restored).not.toBeNull()
    expect(restored!.code).toBe('CONFIG_INVALID')
    expect(restored!.message).toBe('配置坏了')
    expect(restored!.detail).toBe('第 3 行')
    expect(restored!.suggestion).toBe('去修一下')
    expect(restored!.recoverable).toBe(true)
  })

  it('serialize non-AppError as UNKNOWN', () => {
    const err = serializeIpcError(new Error('boom'))
    const restored = deserializeIpcError(err)
    expect(restored!.code).toBe('UNKNOWN')
    expect(restored!.detail).toContain('boom')
  })

  it('toAppError handles raw Error', () => {
    const e = toAppError(new Error('raw'))
    expect(e.code).toBe('UNKNOWN')
    expect(e.recoverable).toBe(true)
  })

  it('toAppError handles already-deserialized AppError', () => {
    const appErr = createAppError('WSL_NOT_FOUND').toJSON()
    expect(toAppError(appErr).code).toBe('WSL_NOT_FOUND')
  })

  it('deserialize returns null for unrelated errors', () => {
    expect(deserializeIpcError('just a string')).toBeNull()
    expect(deserializeIpcError({ nope: true })).toBeNull()
  })

  it('deserialize returns null for malformed WSLPILOT payload', () => {
    expect(deserializeIpcError(new Error('WSLPILOT:{not-json'))).toBeNull()
  })

  it('isAppError type guard', () => {
    expect(isAppError(createAppError('IO_ERROR').toJSON())).toBe(true)
    expect(isAppError(null)).toBe(false)
    expect(isAppError({ code: 'X' })).toBe(false)
  })
})
