import { describe, it, expect } from 'vitest'
import {
  serializeIpcError,
  deserializeIpcError,
  toAppError,
  createAppError,
  isAppError,
  describeError,
  formatErrorLine,
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

  it('★ deserializes through Electron invoke error wrapper', () => {
    // Electron ipcRenderer.invoke 真实 reject 形态
    const inner = createAppError('WSL_NOT_INSTALLED', {
      suggestion: '点击「一键安装 WSL」',
    }).toJSON()
    const electronWrapped = new Error(
      `Error invoking remote method 'distros:start': Error: WSLPILOT:${JSON.stringify(inner)}`,
    )
    const restored = deserializeIpcError(electronWrapped)
    expect(restored).not.toBeNull()
    expect(restored!.code).toBe('WSL_NOT_INSTALLED')
    expect(restored!.suggestion).toContain('一键安装')
    expect(toAppError(electronWrapped).code).toBe('WSL_NOT_INSTALLED')
  })

  it('deserializes when JSON is followed by extra text', () => {
    const inner = createAppError('DISTRO_NOT_FOUND').toJSON()
    const wrapped = new Error(`something WSLPILOT:${JSON.stringify(inner)} and more`)
    const r = deserializeIpcError(wrapped)
    expect(r).not.toBeNull()
    expect(r!.code).toBe('DISTRO_NOT_FOUND')
  })

  it('serializeIpcError keeps AppError shape with recoverable', () => {
    const err = serializeIpcError(createAppError('PERMISSION_DENIED').toJSON())
    const r = deserializeIpcError(err)
    expect(r!.recoverable).toBe(true)
    expect(r!.suggestion).toBeTruthy()
  })

  it('deserialize returns null for malformed WSLPILOT payload', () => {
    expect(deserializeIpcError(new Error('WSLPILOT:{not-json'))).toBeNull()
  })

  it('isAppError type guard', () => {
    expect(isAppError(createAppError('IO_ERROR').toJSON())).toBe(true)
    expect(isAppError(null)).toBe(false)
    expect(isAppError({ code: 'X' })).toBe(false)
  })

  it('deserialize 校验结构：未知错误码/缺字段的伪造 payload 拒绝（review M9）', () => {
    expect(
      deserializeIpcError('WSLPILOT:{"code":"HACK","message":"x","recoverable":true}'),
    ).toBeNull()
    expect(
      deserializeIpcError('WSLPILOT:{"code":"IO_ERROR","message":"","recoverable":true}'),
    ).toBeNull()
    expect(
      deserializeIpcError('WSLPILOT:{"code":"IO_ERROR","message":"x","recoverable":"yes"}'),
    ).toBeNull()
    expect(deserializeIpcError('WSLPILOT:{"code":"IO_ERROR","message":"x"}')).toBeNull()
    const ok = deserializeIpcError('WSLPILOT:{"code":"IO_ERROR","message":"x","recoverable":true}')
    expect(ok?.code).toBe('IO_ERROR')
    expect(deserializeIpcError('WSLPILOT:[1,2,3]')).toBeNull()
  })

  it('describeError 提取 message/suggestion（review C1 根治）', () => {
    const appErr = createAppError('DISTRO_RUNNING').toJSON()
    expect(describeError(appErr)).toEqual({
      message: appErr.message,
      suggestion: appErr.suggestion,
    })
    expect(describeError(new Error('boom')).message).toBe('boom')
    expect(describeError('text').message).toBe('text')
    expect(describeError(null, '兜底').message).toBe('兜底')
    expect(formatErrorLine(appErr)).toContain('—')
    expect(formatErrorLine(new Error('x'))).toBe('x')
    expect(formatErrorLine(undefined, 'f')).toBe('f')
  })
})
