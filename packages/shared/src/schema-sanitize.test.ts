import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { sanitizeWithSchema } from '../src/schema-sanitize'
import { appSettingsSchema, defaultConfig } from '../src/config-schema'

describe('sanitizeWithSchema', () => {
  it('returns valid data unchanged', () => {
    const data = { $schemaVersion: 2, general: { accent: 'ocean' } }
    const out = sanitizeWithSchema(appSettingsSchema, data, defaultConfig('settings') as any)
    expect((out as any).general.accent).toBe('ocean')
  })

  it('keeps valid fields when one field has wrong type', () => {
    const defaults = defaultConfig('settings') as any
    const data = {
      $schemaVersion: 2,
      general: {
        accent: 'sunset', // 合法
        pollIntervalMs: 'NOT_A_NUMBER', // 非法
      },
    }
    const out = sanitizeWithSchema(appSettingsSchema, data, defaults) as any
    expect(out.general.accent).toBe('sunset') // 用户合法配置保留
    expect(out.general.pollIntervalMs).toBe(5000) // 非法字段回退默认
  })

  it('falls back to defaults for entirely invalid data', () => {
    const defaults = defaultConfig('settings') as any
    const out = sanitizeWithSchema(appSettingsSchema, 'garbage', defaults) as any
    expect(out.general.accent).toBe('aurora')
    expect(out.terminal.fontSize).toBe(14)
  })

  it('preserves nested valid objects', () => {
    const defaults = defaultConfig('settings') as any
    const out = sanitizeWithSchema(
      appSettingsSchema,
      { terminal: { fontSize: 18, fontFamily: 'MyFont' }, backup: { keepRecent: 9 } },
      defaults,
    ) as any
    expect(out.terminal.fontSize).toBe(18)
    expect(out.terminal.fontFamily).toBe('MyFont')
    expect(out.backup.keepRecent).toBe(9)
  })

  it('handles simple object schemas', () => {
    const schema = z.object({ a: z.number().default(1), b: z.string().default('x') })
    const out = sanitizeWithSchema(schema, { a: 'bad', b: 'ok' }, { a: 1, b: 'x' })
    expect(out.a).toBe(1)
    expect(out.b).toBe('ok')
  })
})
