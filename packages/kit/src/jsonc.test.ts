import { describe, it, expect } from 'vitest'
import {
  parseJsoncSafe,
  modifyJsonc,
  applyPatchJsonc,
  collectLeafPaths,
  stringifyJsonc,
  parseOrThrow,
} from '../src/jsonc'

describe('parseJsoncSafe', () => {
  it('parses plain JSON', () => {
    expect(parseJsoncSafe('{"a":1}').data).toEqual({ a: 1 })
  })

  it('parses JSONC with comments and trailing commas', () => {
    const text = `{
      // 行注释
      "a": 1, /* 块注释 */
      "b": 2,
    }`
    const r = parseJsoncSafe(text)
    expect(r.errors).toHaveLength(0)
    expect(r.data).toEqual({ a: 1, b: 2 })
  })

  it('returns line number on syntax error', () => {
    const text = '{\n  "a": 1,\n  "b": \n}'
    const r = parseJsoncSafe(text)
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.errorMessage).toContain('第')
    expect(r.errorMessage).toMatch(/\d+/)
  })
})

describe('modifyJsonc / applyPatchJsonc — 注释保留', () => {
  const original = `{
  // 用户注释：默认强调色
  "general": {
    "accent": "aurora", // 主色
    /* 减弱动效 */
    "reduceMotion": false
  },
  "wsl": {
    "defaultShell": "" // shell
  }
}`

  it('modifyJsonc keeps surrounding comments', () => {
    const out = modifyJsonc(original, ['general', 'accent'], 'ocean')
    expect(out).toContain('用户注释：默认强调色')
    expect(out).toContain('主色')
    expect(out).toContain('减弱动效')
    expect(out).toContain('"accent": "ocean"')
  })

  it('applyPatchJsonc applies nested patch and keeps all comments', () => {
    const out = applyPatchJsonc(original, {
      general: { accent: 'sunset', reduceMotion: true },
      wsl: { defaultShell: '/bin/zsh' },
    })
    expect(out).toContain('用户注释：默认强调色')
    expect(out).toContain('主色')
    expect(out).toContain('减弱动效')
    expect(out).toContain('shell')
    expect(out).toContain('"accent": "sunset"')
    expect(out).toContain('"reduceMotion": true')
    expect(out).toContain('"defaultShell": "/bin/zsh"')
  })

  it('does not touch unrelated keys', () => {
    const out = applyPatchJsonc(original, { general: { accent: 'forest' } })
    expect(out).toContain('wsl')
    expect(out).toContain('shell')
  })

  it('collectLeafPaths flattens nested objects, treats arrays as leaves', () => {
    const leaves = collectLeafPaths({
      a: { b: 1, c: 'x' },
      list: [1, 2, 3],
      n: null,
    })
    expect(leaves).toContainEqual({ path: ['a', 'b'], value: 1 })
    expect(leaves).toContainEqual({ path: ['a', 'c'], value: 'x' })
    expect(leaves).toContainEqual({ path: ['list'], value: [1, 2, 3] })
    expect(leaves).toContainEqual({ path: ['n'], value: null })
  })
})

describe('stringifyJsonc / parseOrThrow', () => {
  it('stringify adds header comment', () => {
    const out = stringifyJsonc({ a: 1 }, 'header')
    expect(out.startsWith('// header')).toBe(true)
    expect(parseJsoncSafe(out).data).toEqual({ a: 1 })
  })

  it('parseOrThrow throws structured error with filename', () => {
    expect(() => parseOrThrow('{bad', 'settings.jsonc')).toThrow(/settings\.jsonc/)
  })
})
