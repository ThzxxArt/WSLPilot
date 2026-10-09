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
    onProgress: vi.fn(() => () => {}),
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
    wslAPI.config.get.mockResolvedValue({
      $schemaVersion: 2,
      general: {
        accent: 'ocean',
        locale: 'zh-CN',
        reduceMotion: true,
        pollIntervalMs: 3000,
        closeBehavior: 'quit',
      },
      advanced: {
        showRawCommand: true,
        confirmDestructive: false,
        logLevel: 'debug',
      },
    })
    const { useSettingsStore } = await import('../../src/renderer/stores/settings')
    const s = useSettingsStore()
    await s.load()
    expect(s.accent).toBe('ocean')
    expect(s.pollIntervalMs).toBe(3000)
    expect(s.closeBehavior).toBe('quit')
    expect(s.showRawCommand).toBe(true)
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
    expect(s.pollIntervalMs).toBe(2000)
    expect(s.closeBehavior).toBe('quit')
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
})
