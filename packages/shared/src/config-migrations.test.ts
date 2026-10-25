import { describe, it, expect } from 'vitest'
import { migrateConfig } from './config-migrations'
import { repairDuplicateRuleIds } from './network'

describe('config-migrations 0.1.4', () => {
  it('network v1→v2：重复/空 id 被修复，规则不丢', () => {
    const out = migrateConfig(
      'network',
      {
        $schemaVersion: 1,
        portForwarding: [
          { id: 'a', listenPort: 1 },
          { id: 'a', listenPort: 2 },
          { id: '', listenPort: 3 },
        ],
      },
      2,
    )
    expect(out.$schemaVersion).toBe(2)
    const rules = out.portForwarding as Array<{ id: string; listenPort: number }>
    expect(rules.map((r) => r.listenPort)).toEqual([1, 2, 3])
    expect(new Set(rules.map((r) => r.id)).size).toBe(3)
  })

  it('distros v1→v2：超长/超量标签与快捷动作迁移时截断，不交给 sanitize 丢弃', () => {
    const tags = Array.from({ length: 25 }, (_, i) => `${i}-${'x'.repeat(70)}`)
    const quickActions = Array.from({ length: 25 }, (_, i) => `action-${i}`)
    const out = migrateConfig(
      'distros',
      { $schemaVersion: 1, distros: [{ name: 'Ubuntu', tags, quickActions }] },
      2,
    )
    expect(out.$schemaVersion).toBe(2)
    const list = out.distros as Array<{ tags: string[]; quickActions: string[] }>
    expect(list[0]!.tags).toHaveLength(20)
    expect(list[0]!.tags.every((t) => t.length <= 64)).toBe(true)
    expect(list[0]!.quickActions).toHaveLength(20)
  })

  it('非整数版本向下取整：1.5 仍迁移，2.5 不降级', () => {
    const v15 = migrateConfig('settings', { $schemaVersion: 1.5 }, 2)
    expect(v15.$schemaVersion).toBe(2)

    const v25 = migrateConfig('settings', { $schemaVersion: 2.5, general: { locale: 'zh-CN' } }, 2)
    expect(v25.$schemaVersion).toBe(2)
    expect((v25.general as Record<string, unknown>).locale).toBe('zh-CN')
  })

  it('repairDuplicateRuleIds 幂等：无重复时 changed=false', () => {
    const input = [{ id: 'a' }, { id: 'b' }]
    const once = repairDuplicateRuleIds(input)
    expect(once.changed).toBe(false)
    const twice = repairDuplicateRuleIds(once.rules)
    expect(twice.changed).toBe(false)
  })
})
