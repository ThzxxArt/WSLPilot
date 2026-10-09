import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  defaultUserDataDir,
  configFilePath,
  backupsDir,
  logsDir,
  safeResolve,
  expandEnv,
} from '../src/paths'

describe('paths', () => {
  it('defaultUserDataDir returns a non-empty path', () => {
    const dir = defaultUserDataDir()
    expect(dir).toBeTruthy()
    expect(dir.length).toBeGreaterThan(3)
  })

  it('configFilePath joins correctly', () => {
    expect(configFilePath('/base', 'settings.jsonc')).toBe(join('/base', 'settings.jsonc'))
  })

  it('backupsDir and logsDir join correctly', () => {
    expect(backupsDir('/base')).toBe(join('/base', 'backups'))
    expect(logsDir('/base')).toBe(join('/base', 'logs'))
  })

  describe('safeResolve', () => {
    it('resolves normal relative path', () => {
      expect(safeResolve('/base', 'a/b/c.txt')).toBe(join('/base', 'a', 'b', 'c.txt'))
    })

    it('normalizes backslashes', () => {
      expect(safeResolve('/base', 'a\\b')).toBe(join('/base', 'a', 'b'))
    })

    it('rejects null byte', () => {
      expect(() => safeResolve('/base', 'a\0b')).toThrow()
    })

    it('rejects escaping the base with ..', () => {
      expect(() => safeResolve('/base', '../outside')).toThrow(/逃逸|非法/)
    })

    it('allows .. that stays inside base', () => {
      expect(safeResolve('/base', 'a/../b')).toBe(join('/base', 'b'))
    })
  })

  describe('expandEnv', () => {
    it('expands Windows-style env vars', () => {
      const prev = process.env.TEST_WSLPILOT_VAR
      process.env.TEST_WSLPILOT_VAR = '/hello'
      try {
        expect(expandEnv('%TEST_WSLPILOT_VAR%/x')).toBe('/hello/x')
      } finally {
        if (prev === undefined) delete process.env.TEST_WSLPILOT_VAR
        else process.env.TEST_WSLPILOT_VAR = prev
      }
    })

    it('leaves unknown vars intact', () => {
      expect(expandEnv('%NOPE_NOT_SET%/x')).toBe('%NOPE_NOT_SET%/x')
    })

    it('大小写不敏感（Windows 环境变量语义）', () => {
      process.env.WSLPILOT_TEST_VAR = 'yes'
      expect(expandEnv('%wslpilot_test_var%/x')).toBe('yes/x')
      expect(expandEnv('%WSLPilot_Test_Var%/x')).toBe('yes/x')
      delete process.env.WSLPILOT_TEST_VAR
    })
  })

  describe('safeResolve 拒绝绝对路径输入（review m5）', () => {
    it('rejects absolute / drive / UNC inputs', () => {
      expect(() => safeResolve('/base', '/etc/passwd')).toThrow(/绝对路径/)
      expect(() => safeResolve('/base', 'C:\\evil\\x')).toThrow(/绝对路径/)
      expect(() => safeResolve('/base', '//server/share')).toThrow(/绝对路径/)
      expect(() => safeResolve('/base', '\\\\server\\share')).toThrow(/绝对路径/)
    })

    it('still resolves relative paths and blocks traversal', () => {
      expect(safeResolve('/base', 'a/b')).toBe(join('/base', 'a', 'b'))
      expect(() => safeResolve('/base', '../x')).toThrow(/逃逸/)
    })
  })
})
