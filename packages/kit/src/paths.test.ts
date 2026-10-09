import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
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
  })
})
