import { describe, it, expect } from 'vitest'
import { defaultConfig, appSettingsSchema } from '../src/config-schema'
import { migrateConfig } from '../src/config-migrations'
import { createAppError, ERROR_CATALOG } from '../src/errors'

describe('config schema', () => {
  it('provides valid defaults for settings', () => {
    const s = defaultConfig('settings')
    expect(s.$schemaVersion).toBe(2)
    expect(s.general.accent).toBe('aurora')
    expect(s.general.theme).toBe('light')
    expect(s.advanced.confirmDestructive).toBe(true)
  })

  it('fills missing fields when parsing partial data', () => {
    const parsed = appSettingsSchema.parse({ general: { accent: 'ocean' } })
    expect(parsed.general.accent).toBe('ocean')
    expect(parsed.general.pollIntervalMs).toBe(5000)
    expect(parsed.terminal.fontSize).toBe(14)
  })
})

describe('migrations', () => {
  it('migrates settings v1 → v2', () => {
    const v1 = {
      $schemaVersion: 1,
      general: { locale: 'zh-CN', theme: 'light' },
    }
    const v2 = migrateConfig('settings', v1, 2)
    expect(v2.$schemaVersion).toBe(2)
    expect((v2.general as any).accent).toBe('aurora')
    expect((v2.general as any).locale).toBe('zh-CN')
  })
})

describe('errors', () => {
  it('creates structured error from catalog', () => {
    const e = createAppError('WSL_NOT_INSTALLED')
    expect(e.code).toBe('WSL_NOT_INSTALLED')
    expect(e.message).toBe(ERROR_CATALOG.WSL_NOT_INSTALLED.message)
    expect(e.recoverable).toBe(true)
    expect(e.toJSON().suggestion).toBeTruthy()
  })
})
