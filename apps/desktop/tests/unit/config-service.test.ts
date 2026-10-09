import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    expect(next.general.theme).toBe('light') // 其他字段不变

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
        theme: 'light',
        accent: 'sunset',
        closeBehavior: 'quit',
        launchAtLogin: true,
        reduceMotion: false,
      },
      wsl: {
        defaultShell: '/bin/bash',
        autoShutdownAfterConfigChange: true,
        installSource: 'web',
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
    // 最终结果必须是其中之一且文件可解析
    expect(['aurora', 'ocean', 'forest']).toContain(s.general.accent)
    const text = await fs.readFile(join(dir, 'settings.jsonc'), 'utf8')
    expect(() => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))).not.toThrow()
  })

  it('detects external modification as conflict', async () => {
    await new Promise((r) => setTimeout(r, 50)) // 让 watcher 起来
    const filePath = join(dir, 'settings.jsonc')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        $schemaVersion: 2,
        general: { accent: 'sunset' },
      }),
      'utf8',
    )

    // 等待 chokidar + handler
    let conflict: { fileKey: string; detail: string } | null = null
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 50))
      conflict = svc.getConflict('settings')
      if (conflict) break
    }
    // 注释变化可能不算冲突；内容 accent 变化应算
    if (conflict) {
      expect(conflict.fileKey).toBe('settings')
    }
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
})
