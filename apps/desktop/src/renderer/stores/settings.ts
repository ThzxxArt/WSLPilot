import { defineStore } from 'pinia'
import {
  defaultConfig,
  toAppError,
  type AccentName,
  type AppError,
  type AppSettings,
  type BackupFormat,
  type LogLevel,
  type TerminalTheme,
} from '@wslpilot/shared'

/**
 * 默认值唯一事实源：settings.jsonc schema（defaultConfig）。
 * 禁止在此手抄第二份（review：三套终端默认值漂移根治）。
 */
const cfg = defaultConfig('settings')

function initialState() {
  return {
    accent: cfg.general.accent as AccentName,
    locale: cfg.general.locale as AppSettings['general']['locale'],
    reduceMotion: cfg.general.reduceMotion as boolean,
    autoRefreshOnStart: cfg.general.autoRefreshOnStart as boolean,
    pollIntervalMs: cfg.general.pollIntervalMs as number,
    closeBehavior: cfg.general.closeBehavior as AppSettings['general']['closeBehavior'],
    launchAtLogin: cfg.general.launchAtLogin as boolean,
    showRawCommand: cfg.advanced.showRawCommand as boolean,
    confirmDestructive: cfg.advanced.confirmDestructive as boolean,
    logLevel: cfg.advanced.logLevel as LogLevel,
    hardwareAcceleration: cfg.advanced.hardwareAcceleration as boolean,
    autoUpdate: cfg.advanced.autoUpdate as boolean,
    wslDefaultShell: cfg.wsl.defaultShell as string,
    wslAutoShutdownAfterConfigChange: cfg.wsl.autoShutdownAfterConfigChange as boolean,
    terminalFontFamily: cfg.terminal.fontFamily as string,
    terminalFontSize: cfg.terminal.fontSize as number,
    terminalLineHeight: cfg.terminal.lineHeight as number,
    terminalLetterSpacing: cfg.terminal.letterSpacing as number,
    terminalCursorStyle: cfg.terminal.cursorStyle as 'block' | 'underline' | 'bar',
    terminalCursorBlink: cfg.terminal.cursorBlink as boolean,
    terminalCursorInactiveStyle: cfg.terminal.cursorInactiveStyle,
    terminalSmoothScroll: cfg.terminal.smoothScroll as boolean,
    terminalScrollback: cfg.terminal.scrollback as number,
    terminalCopyOnSelect: cfg.terminal.copyOnSelect as boolean,
    terminalTheme: cfg.terminal.theme as TerminalTheme,
    terminalRightClickBehavior: cfg.terminal.rightClickBehavior,
    terminalPasteWarning: cfg.terminal.pasteWarning,
    terminalShellIntegration: cfg.terminal.shellIntegration,
    terminalConfirmCloseWithRunningProcess: cfg.terminal.confirmCloseWithRunningProcess as boolean,
    terminalDefaultProfileId: cfg.terminal.defaultProfileId as string,
    terminalProfiles: cfg.terminal.profiles,
    terminalWebgl: cfg.terminal.webgl,
    terminalBell: cfg.terminal.bell,
    terminalMinimumContrastRatio: cfg.terminal.minimumContrastRatio,
    workbenchDefaultRoute: cfg.workbench.defaultRoute,
    workbenchAutoCollapseSidebar: cfg.workbench.autoCollapseSidebar as boolean,
    workbenchDensity: cfg.workbench.density,
    workbenchTabPosition: cfg.workbench.tabPosition,
    workbenchShowStatusLine: cfg.workbench.showStatusLine as boolean,
    workbenchShowPaneHeaders: cfg.workbench.showPaneHeaders,
    workbenchSessionRailWidth: cfg.workbench.sessionRailWidth as number,
    workbenchConfirmClosePane: cfg.workbench.confirmClosePane as boolean,
    containersPollIntervalMs: cfg.containers.pollIntervalMs as number,
    containersStatsIntervalMs: cfg.containers.statsIntervalMs as number,
    containersConfirmPrune: cfg.containers.confirmPrune as boolean,
    containersConfirmRemoveRunning: cfg.containers.confirmRemoveRunning as boolean,
    containersDefaultStopTimeoutSec: cfg.containers.defaultStopTimeoutSec as number,
    containersMaskEnvValues: cfg.containers.maskEnvValues as boolean,
    containersLastImage: cfg.containers.lastImage as string,
    backupDefaultDir: cfg.backup.defaultDir as string,
    backupFormat: cfg.backup.format as BackupFormat,
    backupKeepRecent: cfg.backup.keepRecent as number,
    backupAutoBeforeDestructive: cfg.backup.autoBackupBeforeDestructive as boolean,
    lastError: null as AppError | null,
    /** 落盘失败时间戳：界面监听它给出一次性提示（review M-3） */
    persistErrorAt: 0,
    /** load 是否成功完成过（失败态与「还没加载」可区分） */
    loaded: false,
    /** 最近一次 load 失败时间戳：界面监听它给出一次性提示 */
    loadErrorAt: 0,
    version: '',
    /** 代际守卫：并发 load 时只认最新一次发起的响应 */
    loadGen: 0,
    /** 落盘代际（按字段）：旧的失败响应不得回滚更新的写入 */
    persistGens: {} as Record<string, number>,
  }
}

type SettingsState = ReturnType<typeof initialState>

export const useSettingsStore = defineStore('settings', {
  state: initialState,

  actions: {
    /**
     * 加载设置。失败降级到默认值并记录错误——
     * 绝不让启动链卡死在 loading（review C11）。
     * 失败落 lastError + loadErrorAt（界面一次性提示）；成功清 lastError。
     */
    async load() {
      const gen = ++this.loadGen
      try {
        const s = (await window.wslAPI.config.get('settings')) as AppSettings
        // 有更新的 load 在途：旧响应不得覆盖新状态
        if (gen !== this.loadGen) return
        this.accent = s.general.accent
        this.locale = s.general.locale
        this.reduceMotion = s.general.reduceMotion
        this.autoRefreshOnStart = s.general.autoRefreshOnStart
        this.pollIntervalMs = s.general.pollIntervalMs
        this.closeBehavior = s.general.closeBehavior
        this.launchAtLogin = s.general.launchAtLogin
        this.showRawCommand = s.advanced.showRawCommand
        this.confirmDestructive = s.advanced.confirmDestructive
        this.logLevel = s.advanced.logLevel
        this.hardwareAcceleration = s.advanced.hardwareAcceleration
        this.autoUpdate = s.advanced.autoUpdate
        this.wslDefaultShell = s.wsl.defaultShell
        this.wslAutoShutdownAfterConfigChange = s.wsl.autoShutdownAfterConfigChange
        this.terminalFontFamily = s.terminal.fontFamily
        this.terminalFontSize = s.terminal.fontSize
        this.terminalLineHeight = s.terminal.lineHeight
        this.terminalLetterSpacing = s.terminal.letterSpacing
        this.terminalCursorStyle = s.terminal.cursorStyle
        this.terminalCursorBlink = s.terminal.cursorBlink
        this.terminalCursorInactiveStyle = s.terminal.cursorInactiveStyle
        this.terminalSmoothScroll = s.terminal.smoothScroll
        this.terminalScrollback = s.terminal.scrollback
        this.terminalCopyOnSelect = s.terminal.copyOnSelect
        this.terminalTheme = s.terminal.theme
        this.terminalRightClickBehavior = s.terminal.rightClickBehavior
        this.terminalPasteWarning = s.terminal.pasteWarning
        this.terminalShellIntegration = s.terminal.shellIntegration
        this.terminalConfirmCloseWithRunningProcess = s.terminal.confirmCloseWithRunningProcess
        this.terminalDefaultProfileId = s.terminal.defaultProfileId
        this.terminalProfiles = s.terminal.profiles
        this.terminalWebgl = s.terminal.webgl
        this.terminalBell = s.terminal.bell
        this.terminalMinimumContrastRatio = s.terminal.minimumContrastRatio
        this.workbenchDefaultRoute = s.workbench.defaultRoute
        this.workbenchAutoCollapseSidebar = s.workbench.autoCollapseSidebar
        this.workbenchDensity = s.workbench.density
        this.workbenchTabPosition = s.workbench.tabPosition
        this.workbenchShowStatusLine = s.workbench.showStatusLine
        this.workbenchShowPaneHeaders = s.workbench.showPaneHeaders
        this.workbenchSessionRailWidth = s.workbench.sessionRailWidth
        this.workbenchConfirmClosePane = s.workbench.confirmClosePane
        this.containersPollIntervalMs = s.containers.pollIntervalMs
        this.containersStatsIntervalMs = s.containers.statsIntervalMs
        this.containersConfirmPrune = s.containers.confirmPrune
        this.containersConfirmRemoveRunning = s.containers.confirmRemoveRunning
        this.containersDefaultStopTimeoutSec = s.containers.defaultStopTimeoutSec
        this.containersMaskEnvValues = s.containers.maskEnvValues
        this.containersLastImage = s.containers.lastImage
        this.backupDefaultDir = s.backup.defaultDir
        this.backupFormat = s.backup.format
        this.backupKeepRecent = s.backup.keepRecent
        this.backupAutoBeforeDestructive = s.backup.autoBackupBeforeDestructive
        this.lastError = null
        this.loaded = true
      } catch (e) {
        if (gen !== this.loadGen) return
        this.lastError = toAppError(e)
        this.loadErrorAt = Date.now()
      }
      try {
        const version = await window.wslAPI.app.getVersion()
        if (gen === this.loadGen) this.version = version
      } catch {
        if (gen === this.loadGen) this.version = ''
      }
    },

    /**
     * 乐观更新 + 失败回滚的统一落盘入口（review M-3 根治）。
     * 早期 21 个 setter 都是「先改 state 再 await config.set，不 catch」——
     * 落盘失败时开关显示已改、settings.jsonc 未改，重启后悄悄回滚，用户完全不知情。
     * 现在：失败回滚 UI 值 + 记录 lastError + 推进 persistErrorAt 供界面提示。
     *
     * 失败语义（review 0.1.2 明确）：返回 false 且绝不抛出；
     * 调用方必须判返回值决定「成功提示 / 失败提示」，不得依赖 catch 或无条件 success。
     */
    async persistField<K extends keyof SettingsState>(
      field: K,
      value: SettingsState[K],
      patch: Record<string, unknown>,
    ): Promise<boolean> {
      // Pinia 的 this 含 actions，写字段要收敛到状态面
      const state = this as unknown as SettingsState
      const prev = state[field]
      state[field] = value
      // 按字段记代际：旧的失败响应不得回滚更新的写入（防把新值写回旧值）
      const key = String(field)
      const gen = (state.persistGens[key] = (state.persistGens[key] ?? 0) + 1)
      try {
        await window.wslAPI.config.set('settings', patch)
        return true
      } catch (e) {
        if (state.persistGens[key] !== gen) return false
        state[field] = prev
        this.lastError = toAppError(e)
        this.persistErrorAt = Date.now()
        return false
      }
    },

    async setAccent(accent: AccentName) {
      return this.persistField('accent', accent, { general: { accent } })
    },

    async setLocale(locale: AppSettings['general']['locale']) {
      return this.persistField('locale', locale, { general: { locale } })
    },

    async setReduceMotion(reduceMotion: boolean) {
      return this.persistField('reduceMotion', reduceMotion, { general: { reduceMotion } })
    },

    async setAutoRefreshOnStart(autoRefreshOnStart: boolean) {
      return this.persistField('autoRefreshOnStart', autoRefreshOnStart, {
        general: { autoRefreshOnStart },
      })
    },

    async setPollIntervalMs(pollIntervalMs: number) {
      return this.persistField('pollIntervalMs', pollIntervalMs, { general: { pollIntervalMs } })
    },

    async setCloseBehavior(closeBehavior: AppSettings['general']['closeBehavior']) {
      return this.persistField('closeBehavior', closeBehavior, { general: { closeBehavior } })
    },

    /** 开机自启：settings.jsonc 为真相源，主进程监听变更同步系统登录项 */
    async setLaunchAtLogin(launchAtLogin: boolean) {
      return this.persistField('launchAtLogin', launchAtLogin, { general: { launchAtLogin } })
    },

    async setShowRawCommand(showRawCommand: boolean) {
      return this.persistField('showRawCommand', showRawCommand, {
        advanced: { showRawCommand },
      })
    },

    async setConfirmDestructive(confirmDestructive: boolean) {
      return this.persistField('confirmDestructive', confirmDestructive, {
        advanced: { confirmDestructive },
      })
    },

    async setLogLevel(logLevel: LogLevel) {
      return this.persistField('logLevel', logLevel, { advanced: { logLevel } })
    },

    /** 硬件加速：需重启生效（主进程启动早期读取） */
    async setHardwareAcceleration(hardwareAcceleration: boolean) {
      return this.persistField('hardwareAcceleration', hardwareAcceleration, {
        advanced: { hardwareAcceleration },
      })
    },

    /** 启动时自动检查更新（M7）：主进程启动时读取，下次启动生效 */
    async setAutoUpdate(autoUpdate: boolean) {
      return this.persistField('autoUpdate', autoUpdate, { advanced: { autoUpdate } })
    },

    async setWslDefaultShell(defaultShell: string) {
      return this.persistField('wslDefaultShell', defaultShell, { wsl: { defaultShell } })
    },

    async setWslAutoShutdownAfterConfigChange(autoShutdownAfterConfigChange: boolean) {
      return this.persistField('wslAutoShutdownAfterConfigChange', autoShutdownAfterConfigChange, {
        wsl: { autoShutdownAfterConfigChange },
      })
    },

    async setTerminalFontFamily(fontFamily: string) {
      return this.persistField('terminalFontFamily', fontFamily, { terminal: { fontFamily } })
    },

    async setTerminalFontSize(fontSize: number) {
      return this.persistField('terminalFontSize', fontSize, { terminal: { fontSize } })
    },

    async setTerminalLineHeight(lineHeight: number) {
      return this.persistField('terminalLineHeight', lineHeight, { terminal: { lineHeight } })
    },

    async setTerminalCursorStyle(cursorStyle: 'block' | 'underline' | 'bar') {
      return this.persistField('terminalCursorStyle', cursorStyle, {
        terminal: { cursorStyle },
      })
    },

    async setTerminalCursorBlink(cursorBlink: boolean) {
      return this.persistField('terminalCursorBlink', cursorBlink, {
        terminal: { cursorBlink },
      })
    },

    async setTerminalCursorInactiveStyle(
      cursorInactiveStyle: 'outline' | 'block' | 'bar' | 'underline' | 'none',
    ) {
      return this.persistField('terminalCursorInactiveStyle', cursorInactiveStyle, {
        terminal: { cursorInactiveStyle },
      })
    },

    async setTerminalSmoothScroll(smoothScroll: boolean) {
      return this.persistField('terminalSmoothScroll', smoothScroll, {
        terminal: { smoothScroll },
      })
    },

    async setTerminalConfirmCloseWithRunningProcess(confirm: boolean) {
      return this.persistField('terminalConfirmCloseWithRunningProcess', confirm, {
        terminal: { confirmCloseWithRunningProcess: confirm },
      })
    },

    async setTerminalDefaultProfileId(profileId: string) {
      return this.persistField('terminalDefaultProfileId', profileId, {
        terminal: { defaultProfileId: profileId },
      })
    },

    async setTerminalScrollback(scrollback: number) {
      return this.persistField('terminalScrollback', scrollback, { terminal: { scrollback } })
    },

    async setTerminalCopyOnSelect(copyOnSelect: boolean) {
      return this.persistField('terminalCopyOnSelect', copyOnSelect, {
        terminal: { copyOnSelect },
      })
    },

    async setTerminalTheme(theme: TerminalTheme) {
      return this.persistField('terminalTheme', theme, { terminal: { theme } })
    },

    async setTerminalLetterSpacing(letterSpacing: number) {
      return this.persistField('terminalLetterSpacing', letterSpacing, {
        terminal: { letterSpacing },
      })
    },

    async setTerminalRightClickBehavior(
      rightClickBehavior: 'contextMenu' | 'paste' | 'selectWord',
    ) {
      return this.persistField('terminalRightClickBehavior', rightClickBehavior, {
        terminal: { rightClickBehavior },
      })
    },

    async setTerminalPasteWarning(pasteWarning: 'always' | 'multiline' | 'never') {
      return this.persistField('terminalPasteWarning', pasteWarning, {
        terminal: { pasteWarning },
      })
    },

    async setTerminalShellIntegration(shellIntegration: 'off' | 'prompt' | 'on') {
      return this.persistField('terminalShellIntegration', shellIntegration, {
        terminal: { shellIntegration },
      })
    },

    async setTerminalWebgl(webgl: 'auto' | 'on' | 'off') {
      return this.persistField('terminalWebgl', webgl, { terminal: { webgl } })
    },

    async setTerminalBell(bell: 'none' | 'visual' | 'sound') {
      return this.persistField('terminalBell', bell, { terminal: { bell } })
    },

    async setTerminalMinimumContrastRatio(minimumContrastRatio: number) {
      return this.persistField('terminalMinimumContrastRatio', minimumContrastRatio, {
        terminal: { minimumContrastRatio },
      })
    },

    async setWorkbenchDefaultRoute(defaultRoute: 'dashboard' | 'terminal' | 'last') {
      return this.persistField('workbenchDefaultRoute', defaultRoute, {
        workbench: { defaultRoute },
      })
    },

    async setWorkbenchConfirmClosePane(confirmClosePane: boolean) {
      return this.persistField('workbenchConfirmClosePane', confirmClosePane, {
        workbench: { confirmClosePane },
      })
    },

    async setWorkbenchAutoCollapseSidebar(autoCollapseSidebar: boolean) {
      return this.persistField('workbenchAutoCollapseSidebar', autoCollapseSidebar, {
        workbench: { autoCollapseSidebar },
      })
    },

    async setWorkbenchDensity(density: 'comfortable' | 'compact') {
      return this.persistField('workbenchDensity', density, { workbench: { density } })
    },

    async setWorkbenchTabPosition(tabPosition: 'top' | 'left') {
      return this.persistField('workbenchTabPosition', tabPosition, { workbench: { tabPosition } })
    },

    async setWorkbenchShowStatusLine(showStatusLine: boolean) {
      return this.persistField('workbenchShowStatusLine', showStatusLine, {
        workbench: { showStatusLine },
      })
    },

    async setWorkbenchShowPaneHeaders(showPaneHeaders: 'auto' | 'always' | 'never') {
      return this.persistField('workbenchShowPaneHeaders', showPaneHeaders, {
        workbench: { showPaneHeaders },
      })
    },

    async setWorkbenchSessionRailWidth(sessionRailWidth: number) {
      return this.persistField('workbenchSessionRailWidth', sessionRailWidth, {
        workbench: { sessionRailWidth },
      })
    },

    async setContainersPollIntervalMs(pollIntervalMs: number) {
      return this.persistField('containersPollIntervalMs', pollIntervalMs, {
        containers: { pollIntervalMs },
      })
    },

    async setContainersStatsIntervalMs(statsIntervalMs: number) {
      return this.persistField('containersStatsIntervalMs', statsIntervalMs, {
        containers: { statsIntervalMs },
      })
    },

    async setContainersConfirmRemoveRunning(confirmRemoveRunning: boolean) {
      return this.persistField('containersConfirmRemoveRunning', confirmRemoveRunning, {
        containers: { confirmRemoveRunning },
      })
    },

    async setContainersDefaultStopTimeoutSec(defaultStopTimeoutSec: number) {
      return this.persistField('containersDefaultStopTimeoutSec', defaultStopTimeoutSec, {
        containers: { defaultStopTimeoutSec },
      })
    },

    async setContainersLastImage(lastImage: string) {
      return this.persistField('containersLastImage', lastImage, {
        containers: { lastImage },
      })
    },

    async setContainersConfirmPrune(confirmPrune: boolean) {
      return this.persistField('containersConfirmPrune', confirmPrune, {
        containers: { confirmPrune },
      })
    },

    async setContainersMaskEnvValues(maskEnvValues: boolean) {
      return this.persistField('containersMaskEnvValues', maskEnvValues, {
        containers: { maskEnvValues },
      })
    },

    async setBackupDefaultDir(defaultDir: string) {
      return this.persistField('backupDefaultDir', defaultDir, { backup: { defaultDir } })
    },

    async setBackupFormat(format: BackupFormat) {
      return this.persistField('backupFormat', format, { backup: { format } })
    },

    async setBackupKeepRecent(keepRecent: number) {
      return this.persistField('backupKeepRecent', keepRecent, { backup: { keepRecent } })
    },

    async setBackupAutoBeforeDestructive(autoBackupBeforeDestructive: boolean) {
      return this.persistField('backupAutoBeforeDestructive', autoBackupBeforeDestructive, {
        backup: { autoBackupBeforeDestructive },
      })
    },
  },
})
