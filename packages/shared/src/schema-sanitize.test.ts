import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { sanitizeWithSchema } from '../src/schema-sanitize'
import { appSettingsSchema, defaultConfig, networkFileSchema } from '../src/config-schema'

/** record 清洗用例的独立 schema（state.jsonc 的 lastMetrics 幽灵字段已移除 — 0.1.3 根治） */
const recordHolderSchema = z.object({
  $schemaVersion: z.number().int().default(1),
  metrics: z
    .record(
      z.object({
        memUsedKB: z.number(),
        memTotalKB: z.number(),
        diskUsedKB: z.number().default(0),
        diskTotalKB: z.number().default(0),
        cpuPercent: z.number(),
        sampledAt: z.string(),
      }),
    )
    .default({}),
})
const recordHolderDefaults = { $schemaVersion: 1, metrics: {} }

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

  it('record 字段逐键清洗：合法键保留、非法键丢弃（review C2 回归）', () => {
    const data = {
      $schemaVersion: 1,
      metrics: {
        good: {
          memUsedKB: 1,
          memTotalKB: 2,
          diskUsedKB: 0,
          diskTotalKB: 0,
          cpuPercent: 1,
          sampledAt: 'x',
        },
        bad: { memUsedKB: 'x' },
      },
    }
    const out = sanitizeWithSchema(recordHolderSchema, data, recordHolderDefaults as any) as any
    expect(Object.keys(out.metrics)).toEqual(['good'])
    expect(out.metrics.good.memUsedKB).toBe(1)
  })

  it('record 中 null/坏值只丢该键，不清空整表（review C2 回归）', () => {
    const out = sanitizeWithSchema(
      recordHolderSchema,
      {
        metrics: {
          a: { memUsedKB: 1, memTotalKB: 2, cpuPercent: 1, sampledAt: 'x' },
          b: null,
          c: { memUsedKB: 3, memTotalKB: 4, cpuPercent: 2, sampledAt: 'y' },
        },
      },
      recordHolderDefaults as any,
    ) as any
    expect(Object.keys(out.metrics).sort()).toEqual(['a', 'c'])
  })

  it('network 重复 id（语义级 refine 失败）不得整对象回退清空用户配置 — review 0.1.2 审计修复', () => {
    const defaults = defaultConfig('network') as any
    const rules = [
      {
        id: 'dup',
        distro: 'Ubuntu',
        listenAddress: '0.0.0.0',
        listenPort: 3000,
        connectAddress: '127.0.0.1',
        connectPort: 3000,
        enabled: true,
        protocol: 'tcp',
      },
      {
        id: 'dup',
        distro: 'Ubuntu',
        listenAddress: '0.0.0.0',
        listenPort: 3001,
        connectAddress: '127.0.0.1',
        connectPort: 3001,
        enabled: true,
        protocol: 'tcp',
      },
    ]
    const data = {
      $schemaVersion: 1,
      portForwarding: rules,
      proxy: {
        useWindowsProxy: true,
        httpProxy: 'http://127.0.0.1:7890',
        httpsProxy: 'http://127.0.0.1:7891',
        noProxy: 'localhost',
      },
    }
    const out = sanitizeWithSchema(networkFileSchema, data, defaults) as any
    // 数据完整、仅 refine（重复 id）失败：原样保留用户规则与代理，绝不回退默认空表
    expect(out.portForwarding).toHaveLength(2)
    expect(out.portForwarding.map((r: any) => r.id)).toEqual(['dup', 'dup'])
    expect(out.portForwarding[1]!.listenPort).toBe(3001)
    expect(out.proxy).toEqual(data.proxy)
    expect(out.portForwarding).not.toEqual(defaults.portForwarding)
  })

  it('输出键面残缺（默认对象有键而 out 缺键）时仍整对象回退默认值 — review 0.1.2 审计修复', () => {
    // 直接验证对象分支回退判定：字段级 refine 让 retry 失败（顶层 effects 会被 unwrap 剥离，
    // 必须把 refine 放在字段 schema 上）；defaults 含 shape 外键（旧版遗留键）→ out 键面残缺
    const inner = z.object({ a: z.number().default(1) }).superRefine((v, ctx) => {
      if (v.a === 5) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a=5 拒绝' })
    })
    const schema = z.object({ inner: inner.default({}) })
    const defaults = { inner: { a: 1 }, legacy: 7 } as any
    const out = sanitizeWithSchema(schema, { inner: { a: 5 } }, defaults)
    // 若未回退，out.inner.a 会是清洗后的 5；回退后为默认 1
    expect(out.inner.a).toBe(1)
  })
})
