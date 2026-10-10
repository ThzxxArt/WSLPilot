import { describe, it, expect } from 'vitest'
import {
  DIAGNOSTICS_NOTE,
  diagnosticsFileName,
  homeDirVariants,
  sanitizeDiagnosticsText,
  sanitizeDiagnosticsValue,
} from './diagnostics'

describe('诊断脱敏（M7 §15.3）', () => {
  it('主目录全部变体 → %USERPROFILE%', () => {
    const home = 'C:\\Users\\me'
    const text = [
      'defaultDir = C:\\Users\\me\\WSL-Backups',
      'path: C:/Users/me/docs',
      'ignore: C:\\Users\\mee\\x', // 前缀相似但不同用户，不得误伤
    ].join('\n')
    const out = sanitizeDiagnosticsText(text, home)
    expect(out).toContain('%USERPROFILE%\\WSL-Backups')
    expect(out).toContain('%USERPROFILE%/docs')
    // 前缀相似但不同用户（mee），不得被误伤
    expect(out).toContain('C:\\Users\\mee\\x')
    // 主目录路径（后随分隔符）已全部替换
    expect(out).not.toContain('C:\\Users\\me\\')
    expect(out).not.toContain('C:/Users/me/')
  })

  it('大小写不敏感（Windows 路径语义）', () => {
    const out = sanitizeDiagnosticsText('C:\\users\\ME\\x', 'C:\\Users\\me')
    expect(out).toBe('%USERPROFILE%\\x')
  })

  it('URL 凭据打码（代理常见 user:pass@host）', () => {
    const out = sanitizeDiagnosticsText('http://alice:s3cret@127.0.0.1:7890', 'C:\\nope')
    expect(out).toBe('http://***@127.0.0.1:7890')
    expect(out).not.toContain('s3cret')
  })

  it('密钥类赋值打码', () => {
    const out = sanitizeDiagnosticsText('{"token": "abc123", "password":"p@ss"}', 'C:\\nope')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('p@ss')
    expect(out).toContain('***')
  })

  it('homeDirVariants 覆盖分隔符与大小写', () => {
    const variants = homeDirVariants('C:/Users/me')
    expect(variants).toContain('C:/Users/me')
    expect(variants).toContain('C:\\Users\\me')
    expect(homeDirVariants('')).toEqual([])
  })

  it('sanitizeDiagnosticsValue 递归处理嵌套对象与数组', () => {
    const input = JSON.parse(
      '{"backup":{"defaultDir":"C:\\\\Users\\\\me\\\\b"},"list":["C:\\\\Users\\\\me\\\\x",42,null],"__proto__":{"evil":true}}',
    )
    const out = sanitizeDiagnosticsValue(input, 'C:\\Users\\me')
    expect((out as Record<string, any>).backup.defaultDir).toBe('%USERPROFILE%\\b')
    expect((out as Record<string, any>).list[0]).toBe('%USERPROFILE%\\x')
    expect((out as Record<string, any>).list[1]).toBe(42)
    // 原型污染键不进入脱敏结果
    expect(Object.keys(out as Record<string, unknown>)).not.toContain('__proto__')
  })

  it('diagnosticsFileName 命名规范', () => {
    const name = diagnosticsFileName(new Date(2026, 9, 10, 15, 4, 5))
    expect(name).toBe('WSLPilot-diagnostics-20261010-150405.zip')
  })

  it('DIAGNOSTICS_NOTE 说明脱敏规则', () => {
    expect(DIAGNOSTICS_NOTE).toContain('%USERPROFILE%')
    expect(DIAGNOSTICS_NOTE).toContain('脱敏')
  })
})
