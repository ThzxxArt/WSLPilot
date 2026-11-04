import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { configGetImpl, createWslAPI } from '../component/support'

let wslAPI: ReturnType<typeof createWslAPI>
;(globalThis as any).window = { wslAPI: (wslAPI = createWslAPI()) }

const { useSettingsStore } = await import('../../src/renderer/stores/settings')

beforeEach(() => {
  setActivePinia(createPinia())
  wslAPI = createWslAPI()
  ;(globalThis as any).window = { wslAPI }
  vi.clearAllMocks()
})

describe('Settings store setters', () => {
  it('全部 setter 乐观更新并落盘', async () => {
    const s = useSettingsStore()
    const calls: Array<[string, () => Promise<boolean>, keyof typeof s, unknown]> = [
      ['accent', () => s.setAccent('ocean'), 'accent', 'ocean'],
      ['locale', () => s.setLocale('en-US'), 'locale', 'en-US'],
      ['reduceMotion', () => s.setReduceMotion(true), 'reduceMotion', true],
      ['autoRefresh', () => s.setAutoRefreshOnStart(false), 'autoRefreshOnStart', false],
      ['poll', () => s.setPollIntervalMs(7000), 'pollIntervalMs', 7000],
      ['close', () => s.setCloseBehavior('quit'), 'closeBehavior', 'quit'],
      ['launch', () => s.setLaunchAtLogin(true), 'launchAtLogin', true],
      ['raw', () => s.setShowRawCommand(true), 'showRawCommand', true],
      ['destructive', () => s.setConfirmDestructive(false), 'confirmDestructive', false],
      ['log', () => s.setLogLevel('debug'), 'logLevel', 'debug'],
      ['hw', () => s.setHardwareAcceleration(false), 'hardwareAcceleration', false],
      ['update', () => s.setAutoUpdate(false), 'autoUpdate', false],
      ['shell', () => s.setWslDefaultShell('/bin/zsh'), 'wslDefaultShell', '/bin/zsh'],
      [
        'autoshutdown',
        () => s.setWslAutoShutdownAfterConfigChange(true),
        'wslAutoShutdownAfterConfigChange',
        true,
      ],
      ['font', () => s.setTerminalFontFamily('Fira Code'), 'terminalFontFamily', 'Fira Code'],
      ['size', () => s.setTerminalFontSize(16), 'terminalFontSize', 16],
      ['line', () => s.setTerminalLineHeight(1.4), 'terminalLineHeight', 1.4],
      [
        'inactive',
        () => s.setTerminalCursorInactiveStyle('bar'),
        'terminalCursorInactiveStyle',
        'bar',
      ],
      ['smooth', () => s.setTerminalSmoothScroll(false), 'terminalSmoothScroll', false],
      ['cursor', () => s.setTerminalCursorStyle('bar'), 'terminalCursorStyle', 'bar'],
      ['blink', () => s.setTerminalCursorBlink(false), 'terminalCursorBlink', false],
      ['scroll', () => s.setTerminalScrollback(20000), 'terminalScrollback', 20000],
      ['copy', () => s.setTerminalCopyOnSelect(true), 'terminalCopyOnSelect', true],
      ['theme', () => s.setTerminalTheme('dark'), 'terminalTheme', 'dark'],
      ['spacing', () => s.setTerminalLetterSpacing(1), 'terminalLetterSpacing', 1],
      [
        'rightclick',
        () => s.setTerminalRightClickBehavior('paste'),
        'terminalRightClickBehavior',
        'paste',
      ],
      ['paste', () => s.setTerminalPasteWarning('always'), 'terminalPasteWarning', 'always'],
      ['integration', () => s.setTerminalShellIntegration('on'), 'terminalShellIntegration', 'on'],
      ['webgl', () => s.setTerminalWebgl('off'), 'terminalWebgl', 'off'],
      [
        'closeconfirm',
        () => s.setTerminalConfirmCloseWithRunningProcess(false),
        'terminalConfirmCloseWithRunningProcess',
        false,
      ],
      ['defprofile', () => s.setTerminalDefaultProfileId('dev'), 'terminalDefaultProfileId', 'dev'],
      ['bell', () => s.setTerminalBell('visual'), 'terminalBell', 'visual'],
      ['contrast', () => s.setTerminalMinimumContrastRatio(7), 'terminalMinimumContrastRatio', 7],
      [
        'wbcollapse',
        () => s.setWorkbenchAutoCollapseSidebar(false),
        'workbenchAutoCollapseSidebar',
        false,
      ],
      [
        'wbroute',
        () => s.setWorkbenchDefaultRoute('terminal'),
        'workbenchDefaultRoute',
        'terminal',
      ],
      [
        'wbconfirm',
        () => s.setWorkbenchConfirmClosePane(false),
        'workbenchConfirmClosePane',
        false,
      ],
      ['wbdensity', () => s.setWorkbenchDensity('compact'), 'workbenchDensity', 'compact'],
      ['wbtabs', () => s.setWorkbenchTabPosition('left'), 'workbenchTabPosition', 'left'],
      ['wbstatus', () => s.setWorkbenchShowStatusLine(false), 'workbenchShowStatusLine', false],
      [
        'wbheaders',
        () => s.setWorkbenchShowPaneHeaders('always'),
        'workbenchShowPaneHeaders',
        'always',
      ],
      ['wbwidth', () => s.setWorkbenchSessionRailWidth(300), 'workbenchSessionRailWidth', 300],
      ['cstats', () => s.setContainersStatsIntervalMs(2000), 'containersStatsIntervalMs', 2000],
      ['cprune', () => s.setContainersConfirmPrune(false), 'containersConfirmPrune', false],
      ['cmask', () => s.setContainersMaskEnvValues(false), 'containersMaskEnvValues', false],
      ['bdir', () => s.setBackupDefaultDir('D:\\b'), 'backupDefaultDir', 'D:\\b'],
      ['bformat', () => s.setBackupFormat('tar.gz'), 'backupFormat', 'tar.gz'],
      ['bkeep', () => s.setBackupKeepRecent(9), 'backupKeepRecent', 9],
      [
        'bauto',
        () => s.setBackupAutoBeforeDestructive(false),
        'backupAutoBeforeDestructive',
        false,
      ],
    ]
    for (const [, run, field, expected] of calls) {
      await expect(run()).resolves.toBe(true)
      expect(s[field]).toEqual(expected)
    }
    expect(wslAPI.config.set).toHaveBeenCalledTimes(calls.length)
  })

  it('落盘失败：回滚 UI、返回 false、记录 lastError，不抛', async () => {
    const s = useSettingsStore()
    const before = s.accent
    wslAPI.config.set.mockRejectedValue({
      code: 'IO_ERROR',
      message: 'disk full',
      recoverable: true,
    })
    await expect(s.setAccent('forest')).resolves.toBe(false)
    expect(s.accent).toBe(before)
    expect(s.lastError?.message).toBe('disk full')
    expect(s.persistErrorAt).toBeGreaterThan(0)
  })

  it('代际保护：旧请求失败不回滚更新的值', async () => {
    const s = useSettingsStore()
    let rejectFirst!: (e: unknown) => void
    wslAPI.config.set
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject
          }),
      )
      .mockResolvedValueOnce({})
    const p1 = s.setAccent('ocean')
    const p2 = s.setAccent('sunset')
    await expect(p2).resolves.toBe(true)
    rejectFirst({ code: 'IO_ERROR', message: 'old failed', recoverable: true })
    await expect(p1).resolves.toBe(false)
    expect(s.accent).toBe('sunset')
  })

  it('load：成功读取全部字段；失败记录 lastError；版本读取失败降级为空', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.loaded).toBe(true)
    expect(s.terminalProfiles).toEqual([])
    expect(s.workbenchDefaultRoute).toBe('dashboard')
    expect(s.containersPollIntervalMs).toBe(3000)
    expect(s.version).toBe('0.1.0')

    const s2 = useSettingsStore()
    wslAPI.config.get.mockRejectedValue({
      code: 'CONFIG_INVALID',
      message: 'bad config',
      recoverable: true,
    })
    wslAPI.app.getVersion.mockRejectedValue(new Error('nope'))
    await s2.load()
    expect(s2.lastError?.message).toBe('bad config')
    expect(s2.version).toBe('')
  })
})

describe('Settings load 并发/版本分支', () => {
  it('旧 load 响应晚到不覆盖新状态（代际守卫）', async () => {
    const s = useSettingsStore()
    let resolveOld!: (v: unknown) => void
    wslAPI.config.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    wslAPI.config.get.mockImplementation(configGetImpl())
    const p1 = s.load()
    const p2 = s.load()
    await p2
    resolveOld({ general: { accent: 'sunset' } })
    await p1
    expect(s.accent).not.toBe('sunset')
    expect(s.loaded).toBe(true)
  })
})

describe('Settings load 代际失败分支', () => {
  it('旧 load 的 config 失败晚到：不覆盖新状态、不写 lastError', async () => {
    const s = useSettingsStore()
    let rejectOld!: (e: unknown) => void
    wslAPI.config.get.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject
        }),
    )
    wslAPI.config.get.mockImplementation(configGetImpl())
    const p1 = s.load()
    const p2 = s.load()
    await p2
    rejectOld({ code: 'IO_ERROR', message: 'old failure', recoverable: true })
    await p1
    expect(s.lastError).toBeNull()
    expect(s.loaded).toBe(true)
  })
})
