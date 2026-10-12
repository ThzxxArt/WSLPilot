import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createConfigService, type ConfigService } from '../../src/main/services/config-service'
import type { Logger } from '@wslpilot/kit'

function mockLogger(): Logger {
  const noop = () => {}
  return { trace: noop, debug: noop, info: noop, warn: noop, error: noop, setLevel: noop }
}

describe('ConfigService', () => {
  let dir: string
  let svc: ConfigService

  beforeEach(async () => {
    dir = join(tmpdir(), `wslpilot-cfg-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
    svc = await createConfigService(dir, mockLogger())
  })

  afterEach(() => {
    svc.dispose()
  })

  it('creates default config files on first run', async () => {
    const settings = await svc.load('settings')
    expect(settings.$schemaVersion).toBe(2)
    expect(settings.general.accent).toBe('aurora')

    const text = await fs.readFile(join(dir, 'settings.jsonc'), 'utf8')
    expect(text).toContain('WSLPilot settings.jsonc')
    expect(text).toContain('"$schemaVersion": 2')
  })

  it('patch merges nested fields and returns validated result', async () => {
    const next = await svc.patch('settings', { general: { accent: 'ocean', reduceMotion: true } })
    expect(next.general.accent).toBe('ocean')
    expect(next.general.reduceMotion).toBe(true)
    expect(next.general.closeBehavior).toBe('minimizeToTray') // 其他字段不变

    const reloaded = await svc.load('settings')
    expect(reloaded.general.accent).toBe('ocean')
  })

  it('★ patch preserves user comments in settings.jsonc', async () => {
    // 先手工写入带注释的配置
    const filePath = join(dir, 'settings.jsonc')
    const original = `{
  // 用户注释：保留我
  "general": {
    // accent 注释
    "accent": "aurora"
  }
}
`
    await fs.writeFile(filePath, original, 'utf8')

    const svc2 = await createConfigService(dir, mockLogger())
    try {
      await svc2.patch('settings', { general: { accent: 'forest' } })
      const after = await fs.readFile(filePath, 'utf8')
      expect(after).toContain('用户注释：保留我')
      expect(after).toContain('accent 注释')
      expect(after).toContain('"accent": "forest"')
    } finally {
      svc2.dispose()
    }
  })

  it('replace writes whole file (documented no-comment case)', async () => {
    await svc.replace('settings', {
      $schemaVersion: 2,
      general: {
        autoRefreshOnStart: true,
        pollIntervalMs: 5000,
        locale: 'zh-CN',
        accent: 'sunset',
        closeBehavior: 'quit',
        launchAtLogin: true,
        reduceMotion: false,
      },
      wsl: {
        defaultShell: '/bin/bash',
        autoShutdownAfterConfigChange: true,
      },
      terminal: {
        fontFamily: 'Fira Code',
        fontSize: 16,
        lineHeight: 1.4,
        cursorStyle: 'bar',
        cursorBlink: false,
        scrollback: 10000,
        copyOnSelect: true,
        theme: 'follow-app',
      },
      backup: {
        defaultDir: 'D:\\Backup',
        format: 'vhd',
        keepRecent: 3,
        autoBackupBeforeDestructive: false,
      },
      advanced: {
        showRawCommand: true,
        confirmDestructive: false,
        logLevel: 'debug',
        hardwareAcceleration: false,
        autoUpdate: true,
      },
    })
    const s = await svc.load('settings')
    expect(s.general.locale).toBe('zh-CN')
    expect(s.terminal.fontSize).toBe(16)
  })

  it('sanitizes invalid fields without dropping valid ones', async () => {
    const filePath = join(dir, 'distros.jsonc')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        $schemaVersion: 1,
        distros: [
          { name: 'Ubuntu', alias: '主力' }, // 合法（其余字段用默认）
          { name: '', alias: 'bad' }, // 非法 name
        ],
      }),
      'utf8',
    )

    const svc2 = await createConfigService(dir, mockLogger())
    try {
      const d = await svc2.load('distros')
      // 名称非法的条目被 schema 默认丢弃或保留合法的
      const names = d.distros.map((x) => x.name)
      expect(names).toContain('Ubuntu')
      const ubuntu = d.distros.find((x) => x.name === 'Ubuntu')!
      expect(ubuntu.alias).toBe('主力')
      expect(ubuntu.tags).toEqual([])
    } finally {
      svc2.dispose()
    }
  })

  it('backup rotation keeps only CONFIG_BACKUP_KEEP copies', async () => {
    for (let i = 0; i < 6; i++) {
      await svc.patch('settings', { general: { reduceMotion: i % 2 === 0 } })
    }
    const backups = (await fs.readdir(join(dir, 'backups'))).filter((f) =>
      f.startsWith('settings.bak.'),
    )
    expect(backups.length).toBeLessThanOrEqual(3)
    expect(backups.length).toBeGreaterThan(0)
  })

  it('writes are serialized (no interleaved corruption)', async () => {
    await Promise.all([
      svc.patch('settings', { general: { accent: 'aurora' } }),
      svc.patch('settings', { general: { accent: 'ocean' } }),
      svc.patch('settings', { general: { accent: 'forest' } }),
    ])
    const s = await svc.load('settings')
    // FIFO 写队列 → 最终值确定为最后一次写入（弱断言根治：串行保序可失败）
    expect(s.general.accent).toBe('forest')
    const text = await fs.readFile(join(dir, 'settings.jsonc'), 'utf8')
    expect(() => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))).not.toThrow()
  })

  it('detects external modification as conflict (content hash, not time window)', async () => {
    // 写入一次，让 lastSelfWriteHash 记录当前内容
    await svc.patch('settings', { general: { accent: 'aurora' } })

    const filePath = join(dir, 'settings.jsonc')
    // 外部改成不同内容（与自写哈希不同）
    await fs.writeFile(
      filePath,
      JSON.stringify({ $schemaVersion: 2, general: { accent: 'sunset' } }),
      'utf8',
    )

    // review 0.1.2：固定 100ms + 40×25ms 轮询是 chokidar 时序抖动源 → vi.waitFor 条件等待（超时给足）
    await vi.waitFor(
      () => {
        expect(svc.getConflict('settings')).not.toBeNull()
      },
      { timeout: 5000, interval: 25 },
    )
    const conflict = svc.getConflict('settings')
    // ★ 无条件断言 —— 外部内容不同必须被识别为冲突
    expect(conflict).not.toBeNull()
    expect(conflict!.fileKey).toBe('settings')
    expect(conflict!.detail).toContain('外部')
  })

  it('外部改坏（JSONC 解析失败）→ conflict 指明解析失败，不静默采纳坏配置', async () => {
    await svc.patch('settings', { general: { accent: 'aurora' } })
    await fs.writeFile(join(dir, 'settings.jsonc'), '{ 坏文件', 'utf8')

    // review 0.1.2：固定轮询 → vi.waitFor 条件等待
    await vi.waitFor(
      () => {
        expect(svc.getConflict('settings')).not.toBeNull()
      },
      { timeout: 5000, interval: 25 },
    )
    const conflict = svc.getConflict('settings')
    expect(conflict).not.toBeNull()
    expect(conflict!.detail).toContain('解析失败')
  })

  it('外部改成像等价内容（仅加注释）→ 自动吸收，不弹冲突', async () => {
    await svc.patch('settings', { general: { accent: 'aurora' } })
    await new Promise((r) => setTimeout(r, 100))
    const filePath = join(dir, 'settings.jsonc')
    const text = await fs.readFile(filePath, 'utf8')
    await fs.writeFile(filePath, `// 外部只加了注释\n${text}`, 'utf8')
    // 等 watch 走完（含 awaitWriteFinish 稳定窗）
    await new Promise((r) => setTimeout(r, 400))
    expect(svc.getConflict('settings')).toBeNull()
    const s = await svc.load('settings')
    expect(s.general.accent).toBe('aurora')
  })

  it('notify 单个监听器抛错不阻断其余监听器（review 容错）', async () => {
    await svc.patch('settings', { general: { accent: 'aurora' } })
    const second = vi.fn()
    svc.onChange('settings', () => {
      throw new Error('listener boom')
    })
    svc.onChange('settings', second)
    await fs.writeFile(
      join(dir, 'settings.jsonc'),
      JSON.stringify({ $schemaVersion: 2, general: { accent: 'sunset' } }),
      'utf8',
    )
    // review 0.1.2：固定轮询 → vi.waitFor；冲突标记与监听器调用在同一同步处理段落定
    await vi.waitFor(
      () => {
        expect(svc.getConflict('settings')).not.toBeNull()
        expect(second).toHaveBeenCalled()
      },
      { timeout: 5000, interval: 25 },
    )
    expect(svc.getConflict('settings')).not.toBeNull()
    expect(second).toHaveBeenCalled()
  })

  it('冲突未决时 patch/update/replace 拒绝写（不吞外部修改）', async () => {
    await svc.patch('settings', { general: { accent: 'aurora' } })
    const filePath = join(dir, 'settings.jsonc')
    await fs.writeFile(
      filePath,
      JSON.stringify({ $schemaVersion: 2, general: { accent: 'sunset' } }),
      'utf8',
    )
    // review 0.1.2：固定轮询 → vi.waitFor 条件等待
    await vi.waitFor(
      () => {
        expect(svc.getConflict('settings')).not.toBeNull()
      },
      { timeout: 5000, interval: 25 },
    )
    const conflict = svc.getConflict('settings')
    expect(conflict).not.toBeNull()
    const before = await fs.readFile(filePath, 'utf8')

    // 三条写路径都必须拒绝
    await expect(svc.patch('settings', { general: { accent: 'ocean' } })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      message: expect.stringContaining('外部修改冲突'),
    })
    await expect(
      svc.update('settings', (s) => ({ ...s, general: { ...s.general, accent: 'ocean' } })),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    await expect(
      svc.replace('settings', { $schemaVersion: 2, general: { accent: 'ocean' } } as never),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })

    // 外部编辑原样保留（未被静默覆盖），冲突标记仍在
    expect(await fs.readFile(filePath, 'utf8')).toBe(before)
    expect(svc.getConflict('settings')).not.toBeNull()

    // resolveConflict 后写路径恢复
    await svc.resolveConflict('settings', 'reload')
    await expect(svc.patch('settings', { general: { accent: 'forest' } })).resolves.toBeTruthy()
  })

  it('resolveConflict reload takes disk as source of truth', async () => {
    const filePath = join(dir, 'settings.jsonc')
    await fs.writeFile(
      filePath,
      JSON.stringify({ $schemaVersion: 2, general: { accent: 'ocean' } }),
      'utf8',
    )
    const reloaded = await svc.resolveConflict('settings', 'reload')
    expect((reloaded as any).general.accent).toBe('ocean')
    expect(svc.getConflict('settings')).toBeNull()
  })

  it('resolveConflict overwrite writes cache back to disk', async () => {
    await svc.patch('settings', { general: { accent: 'forest' } })
    const filePath = join(dir, 'settings.jsonc')
    await fs.writeFile(
      filePath,
      JSON.stringify({ $schemaVersion: 2, general: { accent: 'ocean' } }),
      'utf8',
    )
    const result = (await svc.resolveConflict('settings', 'overwrite')) as any
    expect(result.general.accent).toBe('forest')
    expect(svc.getConflict('settings')).toBeNull()
  })

  it('resolveConflict ignore 保留应用内状态（与 reload 语义区分 — review M-5）', async () => {
    await svc.patch('settings', { general: { accent: 'aurora' } })
    const filePath = join(dir, 'settings.jsonc')
    await fs.writeFile(
      filePath,
      JSON.stringify({ $schemaVersion: 2, general: { accent: 'sunset' } }),
      'utf8',
    )
    const result = (await svc.resolveConflict('settings', 'ignore')) as any
    // ignore = 忽略外部修改，应用内状态保持不变
    expect(result.general.accent).toBe('aurora')
    expect(svc.getConflict('settings')).toBeNull()

    // reload 才是以磁盘为准
    const reloaded = (await svc.resolveConflict('settings', 'reload')) as any
    expect(reloaded.general.accent).toBe('sunset')
  })

  it('onChange unsubscribe removes listener', async () => {
    let called = 0
    const off = svc.onChange('settings', () => called++)
    await svc.patch('settings', { general: { accent: 'ocean' } })
    const afterFirst = called
    off()
    await svc.patch('settings', { general: { accent: 'aurora' } })
    expect(called).toBe(afterFirst)
  })

  it('getConflict returns null when no conflict', () => {
    expect(svc.getConflict('settings')).toBeNull()
    expect(svc.getConflict('distros')).toBeNull()
  })

  it('serializes concurrent patches without losing last write', async () => {
    const results = await Promise.all([
      svc.patch('settings', { general: { accent: 'aurora' } }),
      svc.patch('settings', { general: { reduceMotion: true } }),
      svc.patch('settings', { terminal: { fontSize: 18 } }),
    ])
    expect(results).toHaveLength(3)
    const s = (await svc.load('settings')) as any
    expect(s.general.reduceMotion).toBe(true)
    expect(s.terminal.fontSize).toBe(18)
  })

  it('loadSync returns cached value without await', async () => {
    await svc.patch('settings', { general: { accent: 'ocean' } })
    const s = svc.loadSync('settings') as any
    expect(s.general.accent).toBe('ocean')
    expect(svc.loadSync('distros').$schemaVersion).toBe(1)
  })

  it('empty patch keeps file intact and comments', async () => {
    const filePath = join(dir, 'settings.jsonc')
    await fs.writeFile(filePath, '{\n  // keep me\n  "general": {}\n}\n', 'utf8')
    const svc2 = await createConfigService(dir, mockLogger())
    try {
      await svc2.patch('settings', {})
      const text = await fs.readFile(filePath, 'utf8')
      expect(text).toContain('keep me')
    } finally {
      svc2.dispose()
    }
  })

  it('rejects patch that fails schema after merge', async () => {
    await expect(
      svc.patch('settings', { general: { pollIntervalMs: 1 } } as any),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  it('replace rejects invalid value with CONFIG_INVALID', async () => {
    await expect(
      svc.replace('settings', { $schemaVersion: 2, general: { pollIntervalMs: -1 } } as any),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  it('update rejects invalid next value', async () => {
    await expect(
      svc.update('settings', (cur) => ({ ...cur, general: { ...cur.general, pollIntervalMs: 1 } })),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  it('deepMerge rejects __proto__ pollution', async () => {
    const { deepMerge } = await import('../../src/main/services/config-service')
    const base = { general: { accent: 'aurora' } } as any
    const polluted = JSON.parse('{"__proto__":{"polluted":true}}')
    const merged = deepMerge(base, polluted)
    expect((merged as any).polluted).toBeUndefined()
    expect(({} as any).polluted).toBeUndefined()
  })

  it('patch survives invalid fields already on disk (sanitize, no ZodError)', async () => {
    const filePath = join(dir, 'settings.jsonc')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        $schemaVersion: 2,
        general: { accent: 'aurora', pollIntervalMs: 100 },
      }),
      'utf8',
    )
    const svc2 = await createConfigService(dir, mockLogger())
    try {
      // 不应抛 ZodError
      const next = await svc2.patch('settings', { general: { accent: 'ocean' } })
      expect((next as any).general.accent).toBe('ocean')
    } finally {
      svc2.dispose()
    }
  })

  it('update runs inside write queue', async () => {
    const r = await svc.update('settings', (cur) => ({
      ...cur,
      general: { ...cur.general, accent: 'forest' },
    }))
    expect(r.general.accent).toBe('forest')
    const loaded = await svc.load('settings')
    expect(loaded.general.accent).toBe('forest')
  })

  // ── 配置迁移集成（review M6：迁移/备份分支零覆盖根治）──

  it('migrates v1 settings to v2, keeps comments, and backs up original', async () => {
    const filePath = join(dir, 'settings.jsonc')
    const v1 = `{
  // 迁移前的用户注释
  "general": {
    "accent": "sunset" // 想保留的注释
  }
}
`
    await fs.writeFile(filePath, v1, 'utf8')
    const svc2 = await createConfigService(dir, mockLogger())
    try {
      const loaded = await svc2.load('settings')
      // 迁移补全新字段并盖章 v2
      expect(loaded.$schemaVersion).toBe(2)
      expect(loaded.general.accent).toBe('sunset')
      expect(loaded.general.launchAtLogin).toBe(false)
      expect(loaded.general.reduceMotion).toBe(false)

      const text = await fs.readFile(filePath, 'utf8')
      expect(text).toContain('"$schemaVersion": 2')
      expect(text).toContain('迁移前的用户注释')

      const backups = (await fs.readdir(join(dir, 'backups'))).filter((f) => f.includes('.v1.'))
      expect(backups.length).toBeGreaterThan(0)
    } finally {
      svc2.dispose()
    }
  })

  it('unknown fields in v1 file survive sanitization after migration', async () => {
    const filePath = join(dir, 'settings.jsonc')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        $schemaVersion: 1,
        general: { accent: 'ocean', legacyFlag: true },
      }),
      'utf8',
    )
    const svc2 = await createConfigService(dir, mockLogger())
    try {
      const loaded = await svc2.load('settings')
      expect(loaded.general.accent).toBe('ocean')
      // 未知字段被 schema 清洗，但绝不抛错锁死加载
      expect((loaded.general as unknown as Record<string, unknown>).legacyFlag).toBeUndefined()
    } finally {
      svc2.dispose()
    }
  })
})
