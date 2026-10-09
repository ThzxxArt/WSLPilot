import { describe, it, expect, beforeEach, vi } from 'vitest'

// mock window.wslAPI
const wslAPI = {
  distros: {
    list: vi.fn(),
    start: vi.fn(),
    terminate: vi.fn(),
    shutdown: vi.fn(),
    setDefault: vi.fn(),
    registryDetail: vi.fn(),
  },
  metrics: {
    sample: vi.fn(),
    sampleOverview: vi.fn(),
  },
  config: {
    get: vi.fn(),
    set: vi.fn(),
    resolveConflict: vi.fn(),
    onChanged: vi.fn(() => () => {}),
    onConflict: vi.fn(() => () => {}),
    openExternal: vi.fn(),
  },
  app: {
    getVersion: vi.fn(async () => '0.1.0'),
    getWslVersion: vi.fn(async () => ({ wslVersion: '2.3', kernelVersion: '5.15' })),
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    onNavigate: vi.fn(() => () => {}),
    openConfigDir: vi.fn(),
  },
}
;(globalThis as any).window = { wslAPI, setInterval, clearInterval, addEventListener: vi.fn() }

const { useDistrosStore } = await import('../../src/renderer/stores/distros')
const { useMetricsStore } = await import('../../src/renderer/stores/metrics')
const { createPinia, setActivePinia } = await import('pinia')

describe('useDistrosStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('refresh loads list', async () => {
    wslAPI.distros.list.mockResolvedValue([
      { name: 'A', state: 'Running', version: 2, isDefault: true },
      { name: 'B', state: 'Stopped', version: 2, isDefault: false },
    ])
    const s = useDistrosStore()
    await s.refresh()
    expect(s.items).toHaveLength(2)
    expect(s.runningCount).toBe(1)
    expect(s.defaultDistro?.name).toBe('A')
  })

  it('refresh captures AppError on failure', async () => {
    wslAPI.distros.list.mockRejectedValue(
      new Error('WSLPILOT:{"code":"WSL_NOT_FOUND","message":"找不到 wsl.exe","recoverable":true}'),
    )
    const s = useDistrosStore()
    await s.refresh()
    expect(s.lastError?.code).toBe('WSL_NOT_FOUND')
  })

  it('start / terminate track busy state', async () => {
    wslAPI.distros.start.mockResolvedValue(undefined)
    wslAPI.distros.terminate.mockResolvedValue(undefined)
    wslAPI.distros.list.mockResolvedValue([])
    const s = useDistrosStore()
    await s.refresh()
    await s.start('A')
    expect(wslAPI.distros.start).toHaveBeenCalledWith('A')
    await s.terminate('A')
    expect(wslAPI.distros.terminate).toHaveBeenCalledWith('A')
    expect(s.isBusy('A')).toBe(false)
  })

  it('setDefault updates isDefault flags', async () => {
    wslAPI.distros.list.mockResolvedValue([
      { name: 'A', state: 'Running', version: 2, isDefault: true },
      { name: 'B', state: 'Stopped', version: 2, isDefault: false },
    ])
    wslAPI.distros.setDefault.mockResolvedValue(undefined)
    const s = useDistrosStore()
    await s.refresh()
    await s.setDefault('B')
    expect(s.items.find((d) => d.name === 'B')!.isDefault).toBe(true)
    expect(s.items.find((d) => d.name === 'A')!.isDefault).toBe(false)
  })

  it('shutdownAll stops all', async () => {
    wslAPI.distros.list.mockResolvedValue([
      { name: 'A', state: 'Running', version: 2, isDefault: false },
    ])
    wslAPI.distros.shutdown.mockResolvedValue(undefined)
    const s = useDistrosStore()
    await s.refresh()
    await s.shutdownAll()
    expect(s.items[0]!.state).toBe('Stopped')
  })
})

describe('useSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load fills from settings.jsonc', async () => {
    // 基于 schema 默认值构造完整对象：mock 形状与真实 AppSettings 对齐（review 根治）
    const { defaultConfig } = await import('@shared/config-schema')
    const base = defaultConfig('settings')
    wslAPI.config.get.mockResolvedValue({
      ...base,
      general: {
        ...base.general,
        accent: 'ocean',
        locale: 'zh-CN',
        reduceMotion: true,
        autoRefreshOnStart: false,
        pollIntervalMs: 3000,
        closeBehavior: 'quit',
        launchAtLogin: true,
      },
      advanced: {
        ...base.advanced,
        showRawCommand: true,
        confirmDestructive: false,
        logLevel: 'debug',
        hardwareAcceleration: false,
      },
      wsl: {
        ...base.wsl,
        defaultShell: '/bin/zsh',
        autoShutdownAfterConfigChange: true,
      },
      terminal: {
        ...base.terminal,
        fontFamily: 'MyMono',
        fontSize: 16,
        lineHeight: 1.3,
        cursorStyle: 'bar',
        cursorBlink: false,
        scrollback: 9000,
        copyOnSelect: true,
        theme: 'custom',
      },
      backup: {
        ...base.backup,
        defaultDir: 'D:\\MyBackups',
        format: 'vhd',
        keepRecent: 9,
        autoBackupBeforeDestructive: false,
      },
    })
    const { useSettingsStore } = await import('../../src/renderer/stores/settings')
    const s = useSettingsStore()
    await s.load()
    expect(s.accent).toBe('ocean')
    expect(s.locale).toBe('zh-CN')
    expect(s.reduceMotion).toBe(true)
    expect(s.autoRefreshOnStart).toBe(false)
    expect(s.pollIntervalMs).toBe(3000)
    expect(s.closeBehavior).toBe('quit')
    expect(s.launchAtLogin).toBe(true)
    expect(s.showRawCommand).toBe(true)
    expect(s.confirmDestructive).toBe(false)
    expect(s.logLevel).toBe('debug')
    expect(s.hardwareAcceleration).toBe(false)
    expect(s.wslDefaultShell).toBe('/bin/zsh')
    expect(s.wslAutoShutdownAfterConfigChange).toBe(true)
    expect(s.terminalFontFamily).toBe('MyMono')
    expect(s.terminalLineHeight).toBe(1.3)
    expect(s.terminalCopyOnSelect).toBe(true)
    expect(s.terminalTheme).toBe('custom')
    expect(s.backupDefaultDir).toBe('D:\\MyBackups')
    expect(s.backupFormat).toBe('vhd')
    expect(s.backupKeepRecent).toBe(9)
    expect(s.backupAutoBeforeDestructive).toBe(false)
    expect(s.lastError).toBeNull()
  })

  it('setters write config patches', async () => {
    wslAPI.config.set.mockResolvedValue({})
    wslAPI.config.get.mockResolvedValue({
      general: { accent: 'aurora', pollIntervalMs: 5000, closeBehavior: 'minimizeToTray' },
      advanced: {},
    })
    const { useSettingsStore } = await import('../../src/renderer/stores/settings')
    const s = useSettingsStore()
    await s.setAccent('sunset')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', { general: { accent: 'sunset' } })
    await s.setPollIntervalMs(2000)
    await s.setCloseBehavior('quit')
    await s.setReduceMotion(true)
    await s.setShowRawCommand(true)
    await s.setConfirmDestructive(false)
    expect(s.reduceMotion).toBe(true)
    expect(s.showRawCommand).toBe(true)
    expect(s.confirmDestructive).toBe(false)
    expect(s.pollIntervalMs).toBe(2000)
    expect(s.closeBehavior).toBe('quit')
    await s.setTerminalFontFamily('Fira')
    await s.setTerminalFontSize(18)
    await s.setTerminalCursorStyle('bar')
    await s.setTerminalCursorBlink(false)
    await s.setTerminalScrollback(12000)
    expect(s.terminalFontFamily).toBe('Fira')
    expect(s.terminalFontSize).toBe(18)
    expect(s.terminalCursorStyle).toBe('bar')
    expect(s.terminalCursorBlink).toBe(false)
    expect(s.terminalScrollback).toBe(12000)
    // load 填充终端字段
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      terminal: { fontSize: 18 },
    })
    await s.setBackupDefaultDir('D:\\Bk')
    await s.setBackupFormat('vhd')
    await s.setBackupKeepRecent(7)
    await s.setBackupAutoBeforeDestructive(false)
    expect(s.backupDefaultDir).toBe('D:\\Bk')
    expect(s.backupFormat).toBe('vhd')
    expect(s.backupKeepRecent).toBe(7)
    expect(s.backupAutoBeforeDestructive).toBe(false)
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      backup: { keepRecent: 7 },
    })
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      backup: { autoBackupBeforeDestructive: false },
    })
  })

  it('load 失败降级默认值并记录 lastError（review C11 回归）', async () => {
    wslAPI.config.get.mockRejectedValue(
      new Error('WSLPILOT:{"code":"CONFIG_INVALID","message":"配置损坏","recoverable":true}'),
    )
    wslAPI.app.getVersion.mockRejectedValue(new Error('boom'))
    const { useSettingsStore } = await import('../../src/renderer/stores/settings')
    const s = useSettingsStore()
    await s.load()
    expect(s.loaded).toBe(true)
    expect(s.lastError?.code).toBe('CONFIG_INVALID')
    expect(s.accent).toBe('aurora')
    expect(s.version).toBe('')
  })
})

describe('useMetricsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sample stores overview and history', async () => {
    wslAPI.metrics.sampleOverview.mockResolvedValue({
      runningCount: 1,
      totalCount: 2,
      memUsedKB: 100,
      memTotalKB: 200,
      diskUsedKB: 10,
      diskTotalKB: 20,
      cpuPercent: 5,
      sampledAt: 'T',
      perDistro: {},
    })
    const s = useMetricsStore()
    await s.sample()
    expect(s.overview.runningCount).toBe(1)
    expect(s.history.cpu).toContain(5)
    expect(s.memLabel).toBeTruthy()
  })

  it('sampleDistro returns null on failure', async () => {
    wslAPI.metrics.sample.mockRejectedValue(new Error('x'))
    const s = useMetricsStore()
    await expect(s.sampleDistro('A')).resolves.toBeNull()
  })

  it('sampleDistro returns metrics on success', async () => {
    wslAPI.metrics.sample.mockResolvedValue({
      memUsedKB: 1,
      memTotalKB: 2,
      diskUsedKB: 3,
      diskTotalKB: 4,
      cpuPercent: 5,
      sampledAt: 'T',
    })
    const s = useMetricsStore()
    const m = await s.sampleDistro('A')
    expect(m!.cpuPercent).toBe(5)
  })

  it('sample ignores non-overview payloads', async () => {
    wslAPI.metrics.sampleOverview.mockResolvedValue({ nope: 1 })
    const s = useMetricsStore()
    await s.sample()
    expect(s.overview.runningCount).toBe(0)
    expect(s.lastError).toBeNull()
  })

  it('sample records AppError and defaults perDistro', async () => {
    wslAPI.metrics.sampleOverview.mockRejectedValue(
      new Error('WSLPILOT:{"code":"TASK_FAILED","message":"采样失败","recoverable":true}'),
    )
    const s = useMetricsStore()
    await s.sample()
    expect(s.lastError?.code).toBe('TASK_FAILED')
    expect(s.loading).toBe(false)

    wslAPI.metrics.sampleOverview.mockResolvedValue({
      runningCount: 1,
      totalCount: 1,
      memUsedKB: 1,
      memTotalKB: 2,
      diskUsedKB: 0,
      diskTotalKB: 0,
      cpuPercent: 0,
      sampledAt: 't',
      // perDistro 缺省
    })
    await s.sample()
    expect(s.overview.perDistro).toEqual({})
  })
})

describe('useDistrosStore edges', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    wslAPI.distros.list.mockResolvedValue([])
  })

  it('start failure records AppError and rethrows', async () => {
    wslAPI.distros.start.mockRejectedValue(
      new Error('WSLPILOT:{"code":"TASK_FAILED","message":"启动失败","recoverable":true}'),
    )
    const s = useDistrosStore()
    await s.refresh()
    await expect(s.start('A')).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(s.lastError?.code).toBe('TASK_FAILED')
    expect(s.isBusy('A')).toBe(false)
  })

  it('shutdownAll failure rethrows', async () => {
    wslAPI.distros.shutdown.mockRejectedValue(new Error('fail'))
    const s = useDistrosStore()
    await expect(s.shutdownAll()).rejects.toThrow()
    expect(s.lastError?.code).toBe('UNKNOWN')
  })

  it('byName / pinned getters', async () => {
    wslAPI.distros.list.mockResolvedValue([
      {
        name: 'A',
        state: 'Running',
        version: 2,
        isDefault: false,
        meta: {
          name: 'A',
          alias: '',
          tags: [],
          color: '',
          icon: '',
          note: '',
          startupCwd: '~',
          pinned: true,
          quickActions: [],
        },
      },
    ])
    const s = useDistrosStore()
    await s.refresh()
    expect(s.byName('A')?.name).toBe('A')
    expect(s.byName('Z')).toBeNull()
    expect(s.pinned).toHaveLength(1)
  })
})
