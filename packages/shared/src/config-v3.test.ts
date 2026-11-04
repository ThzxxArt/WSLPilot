import { describe, it, expect } from 'vitest'
import { CONFIG_FILE_NAMES } from '../src/constants'
import {
  CONFIG_SCHEMAS,
  SCHEMA_VERSIONS,
  appSettingsSchema,
  containerRecipeSchema,
  containersFileSchema,
  defaultConfig,
  distroMetaSchema,
} from '../src/config-schema'
import { migrateConfig } from '../src/config-migrations'
import { sanitizeWithSchema } from '../src/schema-sanitize'

describe('配置 v3 默认值', () => {
  it('settings v3 包含 workbench / containers / 终端新字段', () => {
    const s = defaultConfig('settings')
    expect(s.$schemaVersion).toBe(3)
    expect(s.workbench).toMatchObject({
      defaultRoute: 'dashboard',
      autoCollapseSidebar: true,
      tabPosition: 'top',
      density: 'comfortable',
      showStatusLine: true,
      showPaneHeaders: 'auto',
      sessionRailWidth: 240,
      confirmClosePane: true,
    })
    expect(s.containers).toMatchObject({
      pollIntervalMs: 3000,
      statsIntervalMs: 1000,
      confirmPrune: true,
      confirmRemoveRunning: true,
      defaultStopTimeoutSec: 10,
      maskEnvValues: true,
      lastImage: 'ubuntu:latest',
    })
    expect(s.terminal.theme).toBe('light')
    expect(s.terminal.letterSpacing).toBe(0)
    expect(s.terminal.minimumContrastRatio).toBe(4.5)
    expect(s.terminal.shellIntegration).toBe('off')
    expect(s.terminal.profiles).toEqual([])
  })

  it('schema parse 与 defaultConfig 一致（唯一事实源）', () => {
    expect(appSettingsSchema.parse({})).toEqual(defaultConfig('settings'))
  })

  it('containers.jsonc v1 默认空配方 / 空最近镜像', () => {
    const c = defaultConfig('containers')
    expect(c).toEqual({ $schemaVersion: 1, recipes: [], recentImages: [] })
    expect(CONFIG_FILE_NAMES.containers).toBe('containers.jsonc')
    expect(CONFIG_SCHEMAS.containers.parse({})).toEqual(c)
  })

  it('SCHEMA_VERSIONS 与 schema 默认戳一致', () => {
    expect(SCHEMA_VERSIONS).toMatchObject({
      settings: 3,
      distros: 3,
      containers: 1,
      uiState: 2,
      network: 2,
      state: 1,
    })
    expect(CONFIG_SCHEMAS.settings.parse({}).$schemaVersion).toBe(3)
    expect(CONFIG_SCHEMAS.distros.parse({ distros: [] }).$schemaVersion).toBe(3)
    expect(CONFIG_SCHEMAS.uiState.parse({}).$schemaVersion).toBe(2)
  })

  it('distros v3 元数据新字段默认值', () => {
    const m = distroMetaSchema.parse({ name: 'Ubuntu' })
    expect(m.terminalProfileId).toBe('')
    expect(m.hidden).toBe(false)
    expect(m.defaultShell).toBe('')
  })
})

describe('settings v2 → v3 迁移', () => {
  it('auto → light，custom → high-contrast，dark 保留', () => {
    const make = (theme: string) =>
      migrateConfig(
        'settings',
        { $schemaVersion: 2, general: { accent: 'ocean' }, terminal: { theme } },
        3,
      ) as any
    expect(make('auto').terminal.theme).toBe('light')
    expect(make('custom').terminal.theme).toBe('high-contrast')
    expect(make('dark').terminal.theme).toBe('dark')
    expect(make('follow-app').terminal.theme).toBe('follow-app')
    expect(make('light').terminal.theme).toBe('light')
    expect(make('high-contrast').terminal.theme).toBe('high-contrast')
    expect(make('neon').terminal.theme).toBe('light')
  })

  it('保留用户已有 terminal 字段，并补 workbench/containers 默认值', () => {
    const v2 = {
      $schemaVersion: 2,
      general: { accent: 'sunset', locale: 'en-US' },
      terminal: {
        theme: 'custom',
        fontFamily: 'Fira Code',
        fontSize: 18,
        scrollback: 20000,
      },
      wsl: { defaultShell: '/bin/zsh' },
    }
    const v3 = migrateConfig('settings', v2, 3) as any
    expect(v3.$schemaVersion).toBe(3)
    expect(v3.terminal.fontFamily).toBe('Fira Code')
    expect(v3.terminal.fontSize).toBe(18)
    expect(v3.terminal.scrollback).toBe(20000)
    expect(v3.terminal.theme).toBe('high-contrast')
    expect(v3.wsl.defaultShell).toBe('/bin/zsh')
    expect(v3.general.accent).toBe('sunset')
    expect(v3.workbench.defaultRoute).toBe('dashboard')
    expect(v3.containers.statsIntervalMs).toBe(1000)
  })

  it('已是 v3 不重复迁移；v1 可一路迁到 v3', () => {
    const done = migrateConfig('settings', { $schemaVersion: 3, general: {} }, 3) as any
    expect(done.$schemaVersion).toBe(3)

    const v1 = migrateConfig('settings', { $schemaVersion: 1, general: {} }, 3) as any
    expect(v1.$schemaVersion).toBe(3)
    expect(v1.general.accent).toBe('aurora')
    expect(v1.terminal.theme).toBe('light')
    expect(v1.workbench).toBeTruthy()
  })
})

describe('distros v2 → v3 迁移', () => {
  it('每个发行版补 terminalProfileId / hidden / defaultShell，保留原字段', () => {
    const v2 = {
      $schemaVersion: 2,
      distros: [
        { name: 'Ubuntu', alias: '开发', tags: ['dev'], quickActions: ['ls'] },
        { name: 'Debian' },
        { bad: true },
        null,
      ],
    }
    const v3 = migrateConfig('distros', v2, 3) as any
    expect(v3.$schemaVersion).toBe(3)
    expect(v3.distros[0]).toMatchObject({
      name: 'Ubuntu',
      alias: '开发',
      tags: ['dev'],
      terminalProfileId: '',
      hidden: false,
      defaultShell: '',
    })
    expect(v3.distros[1]).toMatchObject({ name: 'Debian', terminalProfileId: '' })
    expect(v3.distros).toHaveLength(4)
  })

  it('v3 原样保留（不重复盖章）', () => {
    const v3 = migrateConfig(
      'distros',
      { $schemaVersion: 3, distros: [{ name: 'Ubuntu', hidden: true }] },
      3,
    ) as any
    expect(v3.distros[0].hidden).toBe(true)
  })
})

describe('ui-state v1 → v2 迁移', () => {
  it('补 workbench 空布局；旧 terminalLayout 保留供迁移读取', () => {
    const v1 = {
      $schemaVersion: 1,
      window: { width: 1180, height: 760 },
      terminalLayout: [{ id: 't1', title: 'Ubuntu', layout: { kind: 'leaf', ptyId: 'p1' } }],
    }
    const v2 = migrateConfig('uiState', v1, 2) as any
    expect(v2.$schemaVersion).toBe(2)
    expect(v2.workbench).toEqual({ activeTabId: '', sessionRailOpen: false, tabs: [] })
    expect(v2.terminalLayout).toHaveLength(1)
    expect(v2.window.width).toBe(1180)
  })

  it('已有 workbench 不被覆盖', () => {
    const v2 = migrateConfig(
      'uiState',
      {
        $schemaVersion: 1,
        workbench: { activeTabId: 'x', sessionRailOpen: true, tabs: [] },
      },
      2,
    ) as any
    expect(v2.workbench.activeTabId).toBe('x')
    expect(v2.workbench.sessionRailOpen).toBe(true)
  })
})

describe('containers.jsonc 校验与清洗', () => {
  const validRecipe = {
    id: 'web',
    label: 'Web',
    image: 'nginx:latest',
    command: ['nginx'],
    ports: [{ host: 8080, container: 80 }],
    mounts: [{ host: 'D:\\www', container: '/html', readOnly: true }],
    env: { A: '1' },
    detach: true,
    rm: false,
  }

  it('合法配方通过并补默认值', () => {
    const r = containerRecipeSchema.parse({ id: 'x', label: 'X', image: 'ubuntu' })
    expect(r.command).toEqual([])
    expect(r.ports).toEqual([])
    expect(r.mounts).toEqual([])
    expect(r.env).toEqual({})
    expect(r.detach).toBe(true)
    expect(r.rm).toBe(false)
  })

  it('非法配方字段被拒绝（正例对应反例）', () => {
    expect(() => containerRecipeSchema.parse({ id: '', label: 'X', image: 'a' })).toThrow()
    expect(() =>
      containerRecipeSchema.parse({
        id: 'x',
        label: 'X',
        image: 'a',
        ports: [{ host: 0, container: 80 }],
      }),
    ).toThrow()
    expect(() =>
      containerRecipeSchema.parse({ id: 'x', label: 'X', image: 'a', env: { 'BAD NAME': '1' } }),
    ).toThrow()
    expect(() =>
      containerRecipeSchema.parse({
        id: 'x',
        label: 'X',
        image: 'a',
        mounts: [{ host: 'rel', container: '/a' }],
      }),
    ).toThrow()
  })

  it('清洗：保留合法配方，丢弃非法项，不丢其他字段', () => {
    const data = {
      $schemaVersion: 1,
      recipes: [
        validRecipe,
        { id: '', label: 'bad', image: '' },
        { ...validRecipe, id: 'web2', label: 'Web2' },
      ],
      recentImages: ['nginx:latest', 'ubuntu:24.04'],
    }
    const out = sanitizeWithSchema(containersFileSchema, data, defaultConfig('containers'))
    expect(out.recipes.map((r) => r.id)).toEqual(['web', 'web2'])
    expect(out.recentImages).toEqual(['nginx:latest', 'ubuntu:24.04'])
  })

  it('清洗：整体非法时回退默认空配方（文件仍可用）', () => {
    const out = sanitizeWithSchema(
      containersFileSchema,
      { $schemaVersion: 1, recipes: 'not-an-array', recentImages: 42 },
      defaultConfig('containers'),
    )
    expect(out.recipes).toEqual([])
    expect(out.recentImages).toEqual([])
  })

  it('settings 单字段非法时只回退该字段（不丢整个配置）', () => {
    const out = sanitizeWithSchema(
      appSettingsSchema,
      {
        $schemaVersion: 3,
        general: { accent: 'forest', pollIntervalMs: -1 },
        terminal: { theme: 'neon', fontSize: 16 },
      },
      defaultConfig('settings'),
    )
    expect(out.general.accent).toBe('forest')
    expect(out.general.pollIntervalMs).toBe(5000)
    expect(out.terminal.theme).toBe('light')
    expect(out.terminal.fontSize).toBe(16)
  })
})

describe('迁移与版本戳', () => {
  it('containers 无迁移链：目标版本 1 原样返回', () => {
    const out = migrateConfig('containers', { $schemaVersion: 1, recipes: [] }, 1) as any
    expect(out.$schemaVersion).toBe(1)
  })

  it('settings 目标版本超出链长度时删除版本戳（不假盖章）', () => {
    const out = migrateConfig('settings', { $schemaVersion: 1, general: {} }, 4) as any
    expect(out.$schemaVersion).toBeUndefined()
    expect(out.workbench).toBeTruthy()
  })
})

describe('迁移脏数据防御（0.2.0）', () => {
  it('settings v2 的 workbench/containers 非对象时不展开字符/数组', () => {
    const v3 = migrateConfig(
      'settings',
      {
        $schemaVersion: 2,
        general: {},
        workbench: 'bad',
        containers: [1, 2],
        terminal: null,
      },
      3,
    ) as any
    expect(v3.workbench.defaultRoute).toBe('dashboard')
    expect(v3.containers.statsIntervalMs).toBe(1000)
    expect(v3.terminal.theme).toBe('light')
    expect(v3['0']).toBeUndefined()
  })

  it('ui-state v1 的 workbench 是数组/字符串时使用默认布局', () => {
    const a = migrateConfig('uiState', { $schemaVersion: 1, workbench: [1, 2] }, 2) as any
    expect(a.workbench).toEqual({ activeTabId: '', sessionRailOpen: false, tabs: [] })
    expect(a['0']).toBeUndefined()
    const b = migrateConfig('uiState', { $schemaVersion: 1, workbench: 'bad' }, 2) as any
    expect(b.workbench.tabs).toEqual([])
  })
})
