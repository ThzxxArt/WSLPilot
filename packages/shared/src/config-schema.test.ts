import { describe, it, expect } from 'vitest'
import {
  defaultConfig,
  appSettingsSchema,
  uiStateFileSchema,
  distrosFileSchema,
  networkFileSchema,
  distroMetaSchema,
  wslActionSchema,
} from '../src/config-schema'
import { migrateConfig } from '../src/config-migrations'
import { sanitizeWithSchema } from '../src/schema-sanitize'
import { DEFAULT_BACKUP_KEEP, DEFAULT_POLL_INTERVAL_MS } from '../src/constants'
import { createAppError, ERROR_CATALOG } from '../src/errors'

describe('config schema', () => {
  it('provides valid defaults for settings', () => {
    const s = defaultConfig('settings')
    expect(s.$schemaVersion).toBe(2)
    expect(s.general.accent).toBe('aurora')
    expect(s.advanced.confirmDestructive).toBe(true)
  })

  it('fills missing fields when parsing partial data', () => {
    const parsed = appSettingsSchema.parse({ general: { accent: 'ocean' } })
    expect(parsed.general.accent).toBe('ocean')
    expect(parsed.general.pollIntervalMs).toBe(5000)
    expect(parsed.terminal.fontSize).toBe(14)
  })

  it('默认值单源：pollIntervalMs / keepRecent 引用 shared 常量（禁再抄 5000/5）', () => {
    const s = defaultConfig('settings')
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(5000)
    expect(DEFAULT_BACKUP_KEEP).toBe(5)
    expect(s.general.pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS)
    expect(s.backup.keepRecent).toBe(DEFAULT_BACKUP_KEEP)
  })
})

describe('uiState 幽灵字段根治', () => {
  it('旧配置带 lastSelectedDistro/activeView/tableSort 被 sanitize 剥离且不报错', () => {
    const legacy = {
      $schemaVersion: 1,
      window: { width: 900, height: 600, x: 1, y: 2, maximized: true },
      lastSelectedDistro: 'Ubuntu-22.04',
      activeView: 'dashboard',
      tableSort: { key: 'name', dir: 'desc' },
      sidebarCollapsed: true,
      recentCommands: ['wsl --list'],
    }
    const out = sanitizeWithSchema(
      uiStateFileSchema,
      legacy,
      defaultConfig('uiState') as any,
    ) as Record<string, unknown>
    expect(out.lastSelectedDistro).toBeUndefined()
    expect(out.activeView).toBeUndefined()
    expect(out.tableSort).toBeUndefined()
    // 存活字段原样保留
    expect(out.sidebarCollapsed).toBe(true)
    expect(out.recentCommands).toEqual(['wsl --list'])
    expect(out.window).toMatchObject({ width: 900, maximized: true })
  })

  it('parse 同样剥离幽灵键（非 strict，剩余键面固定）', () => {
    const parsed = uiStateFileSchema.parse({
      lastSelectedDistro: 'U',
      activeView: 'x',
      tableSort: { key: 'name', dir: 'asc' },
    })
    expect(Object.keys(parsed).sort()).toEqual(
      ['$schemaVersion', 'recentCommands', 'sidebarCollapsed', 'terminalLayout', 'window'].sort(),
    )
    // 0.1.3：终端分屏布局默认空数组（窗口重载恢复的持久化位）
    expect(parsed.terminalLayout).toEqual([])
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

  it('version ≤ 0 按 v1 迁移；未来版本不盖章（review M5 回归）', () => {
    const zero = migrateConfig(
      'settings',
      { $schemaVersion: 0, general: { locale: 'zh-CN' } },
      2,
    ) as any
    expect(zero.$schemaVersion).toBe(2)
    expect(zero.general.accent).toBe('aurora') // v1→v2 迁移真正执行

    const future = migrateConfig(
      'settings',
      { $schemaVersion: 5, general: { accent: 'ocean' } },
      2,
    ) as any
    expect(future.$schemaVersion).toBe(5) // 拒绝降级盖章
    expect(future.general.accent).toBe('ocean')
  })

  it('迁移链不完整时不假盖章（fail-safe 补测 — review 0.1.2）', () => {
    // 输入已达目标版本：原样保留，不多次迁移
    const done = migrateConfig(
      'settings',
      { $schemaVersion: 2, general: { accent: 'ocean' } },
      2,
    ) as any
    expect(done.$schemaVersion).toBe(2)
    expect(done.general.accent).toBe('ocean')

    // 目标版本超出链长度（链不完整）：迁移到链条尽头后**删除版本戳**，决不给假盖章
    const beyond = migrateConfig('settings', { $schemaVersion: 1, general: {} }, 3) as any
    expect(beyond.$schemaVersion).toBeUndefined()
    expect(beyond.general.accent).toBe('aurora') // 链条能到的一步已如实执行
  })
})

describe('config schema 加固（review 0.1.2）', () => {
  it('distroMeta.name 接入执行侧同名断言（控制字符/非法形态拒绝）', () => {
    const bad = distrosFileSchema.safeParse({
      $schemaVersion: 1,
      distros: [{ name: 'a\u0000b' }],
    })
    expect(bad.success).toBe(false)
    const ok = distrosFileSchema.safeParse({
      $schemaVersion: 1,
      distros: [{ name: 'Ubuntu-22.04' }],
    })
    expect(ok.success).toBe(true)
  })

  it('portForwarding 重复 id 拒绝（执行白名单键必须唯一）', () => {
    const dup = networkFileSchema.safeParse({
      $schemaVersion: 1,
      portForwarding: [
        { id: 'dup', distro: 'U', listenPort: 1, connectPort: 1 },
        { id: 'dup', distro: 'U', listenPort: 2, connectPort: 2 },
      ],
    })
    expect(dup.success).toBe(false)
    if (!dup.success) {
      // 失败原因必须来自 id 唯一性 refine，而非其它必填缺失
      expect(dup.error.issues.some((i) => /id 重复/.test(i.message))).toBe(true)
    }
    const ok = networkFileSchema.safeParse({
      $schemaVersion: 1,
      portForwarding: [
        { id: 'a', distro: 'U', listenPort: 1, connectPort: 1 },
        { id: 'b', distro: 'U', listenPort: 2, connectPort: 2 },
      ],
    })
    expect(ok.success).toBe(true)
  })

  it('动作 id / quickActions / meta name 读入时 trim，执行查找与存储键一致', () => {
    const action = wslActionSchema.parse({ id: '  git:pull  ', label: ' 拉取 ', program: 'git' })
    expect(action.id).toBe('git:pull')
    const meta = distroMetaSchema.parse({
      name: '  Ubuntu  ',
      quickActions: ['  git:pull  '],
    })
    expect(meta.name).toBe('Ubuntu')
    expect(meta.quickActions).toEqual(['git:pull'])
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
