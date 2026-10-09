import { defineStore } from 'pinia'
import type {
  AccentName,
  AppSettings,
  BackupFormat,
  LogLevel,
  TerminalTheme,
} from '@wslpilot/shared'
import { defaultConfig } from '@shared/config-schema'
import { toAppError, type AppError } from '@shared/errors'

/**
 * 默认值唯一事实源：settings.jsonc schema（defaultConfig）。
 * 禁止在此手抄第二份（review：三套终端默认值漂移根治）。
 */
const cfg = defaultConfig('settings')

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    loaded: false,
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
    wslDefaultShell: cfg.wsl.defaultShell as string,
    wslAutoShutdownAfterConfigChange: cfg.wsl.autoShutdownAfterConfigChange as boolean,
    terminalFontFamily: cfg.terminal.fontFamily as string,
    terminalFontSize: cfg.terminal.fontSize as number,
    terminalLineHeight: cfg.terminal.lineHeight as number,
    terminalCursorStyle: cfg.terminal.cursorStyle as 'block' | 'underline' | 'bar',
    terminalCursorBlink: cfg.terminal.cursorBlink as boolean,
    terminalScrollback: cfg.terminal.scrollback as number,
    terminalCopyOnSelect: cfg.terminal.copyOnSelect as boolean,
    terminalTheme: cfg.terminal.theme as TerminalTheme,
    backupDefaultDir: cfg.backup.defaultDir as string,
    backupFormat: cfg.backup.format as BackupFormat,
    backupKeepRecent: cfg.backup.keepRecent as number,
    backupAutoBeforeDestructive: cfg.backup.autoBackupBeforeDestructive as boolean,
    lastError: null as AppError | null,
    version: '',
  }),

  actions: {
    /**
     * 加载设置。失败降级到默认值并记录错误——
     * 绝不让启动链卡死在 loading（review C11）。
     */
    async load() {
      try {
        const s = (await window.wslAPI.config.get('settings')) as AppSettings
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
        this.wslDefaultShell = s.wsl.defaultShell
        this.wslAutoShutdownAfterConfigChange = s.wsl.autoShutdownAfterConfigChange
        this.terminalFontFamily = s.terminal.fontFamily
        this.terminalFontSize = s.terminal.fontSize
        this.terminalLineHeight = s.terminal.lineHeight
        this.terminalCursorStyle = s.terminal.cursorStyle
        this.terminalCursorBlink = s.terminal.cursorBlink
        this.terminalScrollback = s.terminal.scrollback
        this.terminalCopyOnSelect = s.terminal.copyOnSelect
        this.terminalTheme = s.terminal.theme
        this.backupDefaultDir = s.backup.defaultDir
        this.backupFormat = s.backup.format
        this.backupKeepRecent = s.backup.keepRecent
        this.backupAutoBeforeDestructive = s.backup.autoBackupBeforeDestructive
      } catch (e) {
        this.lastError = toAppError(e)
      }
      try {
        this.version = await window.wslAPI.app.getVersion()
      } catch {
        this.version = ''
      }
      this.loaded = true
    },

    async setAccent(accent: AccentName) {
      this.accent = accent
      await window.wslAPI.config.set('settings', { general: { accent } })
    },

    async setLocale(locale: AppSettings['general']['locale']) {
      this.locale = locale
      await window.wslAPI.config.set('settings', { general: { locale } })
    },

    async setReduceMotion(reduceMotion: boolean) {
      this.reduceMotion = reduceMotion
      await window.wslAPI.config.set('settings', { general: { reduceMotion } })
    },

    async setAutoRefreshOnStart(autoRefreshOnStart: boolean) {
      this.autoRefreshOnStart = autoRefreshOnStart
      await window.wslAPI.config.set('settings', { general: { autoRefreshOnStart } })
    },

    async setPollIntervalMs(pollIntervalMs: number) {
      this.pollIntervalMs = pollIntervalMs
      await window.wslAPI.config.set('settings', { general: { pollIntervalMs } })
    },

    async setCloseBehavior(closeBehavior: AppSettings['general']['closeBehavior']) {
      this.closeBehavior = closeBehavior
      await window.wslAPI.config.set('settings', { general: { closeBehavior } })
    },

    /** 开机自启：settings.jsonc 为真相源，主进程监听变更同步系统登录项 */
    async setLaunchAtLogin(launchAtLogin: boolean) {
      this.launchAtLogin = launchAtLogin
      await window.wslAPI.config.set('settings', { general: { launchAtLogin } })
    },

    async setShowRawCommand(showRawCommand: boolean) {
      this.showRawCommand = showRawCommand
      await window.wslAPI.config.set('settings', { advanced: { showRawCommand } })
    },

    async setConfirmDestructive(confirmDestructive: boolean) {
      this.confirmDestructive = confirmDestructive
      await window.wslAPI.config.set('settings', { advanced: { confirmDestructive } })
    },

    async setLogLevel(logLevel: LogLevel) {
      this.logLevel = logLevel
      await window.wslAPI.config.set('settings', { advanced: { logLevel } })
    },

    /** 硬件加速：需重启生效（主进程启动早期读取） */
    async setHardwareAcceleration(hardwareAcceleration: boolean) {
      this.hardwareAcceleration = hardwareAcceleration
      await window.wslAPI.config.set('settings', { advanced: { hardwareAcceleration } })
    },

    async setWslDefaultShell(defaultShell: string) {
      this.wslDefaultShell = defaultShell
      await window.wslAPI.config.set('settings', { wsl: { defaultShell } })
    },

    async setWslAutoShutdownAfterConfigChange(autoShutdownAfterConfigChange: boolean) {
      this.wslAutoShutdownAfterConfigChange = autoShutdownAfterConfigChange
      await window.wslAPI.config.set('settings', { wsl: { autoShutdownAfterConfigChange } })
    },

    async setTerminalFontFamily(fontFamily: string) {
      this.terminalFontFamily = fontFamily
      await window.wslAPI.config.set('settings', { terminal: { fontFamily } })
    },

    async setTerminalFontSize(fontSize: number) {
      this.terminalFontSize = fontSize
      await window.wslAPI.config.set('settings', { terminal: { fontSize } })
    },

    async setTerminalLineHeight(lineHeight: number) {
      this.terminalLineHeight = lineHeight
      await window.wslAPI.config.set('settings', { terminal: { lineHeight } })
    },

    async setTerminalCursorStyle(cursorStyle: 'block' | 'underline' | 'bar') {
      this.terminalCursorStyle = cursorStyle
      await window.wslAPI.config.set('settings', { terminal: { cursorStyle } })
    },

    async setTerminalCursorBlink(cursorBlink: boolean) {
      this.terminalCursorBlink = cursorBlink
      await window.wslAPI.config.set('settings', { terminal: { cursorBlink } })
    },

    async setTerminalScrollback(scrollback: number) {
      this.terminalScrollback = scrollback
      await window.wslAPI.config.set('settings', { terminal: { scrollback } })
    },

    async setTerminalCopyOnSelect(copyOnSelect: boolean) {
      this.terminalCopyOnSelect = copyOnSelect
      await window.wslAPI.config.set('settings', { terminal: { copyOnSelect } })
    },

    async setTerminalTheme(theme: TerminalTheme) {
      this.terminalTheme = theme
      await window.wslAPI.config.set('settings', { terminal: { theme } })
    },

    async setBackupDefaultDir(defaultDir: string) {
      this.backupDefaultDir = defaultDir
      await window.wslAPI.config.set('settings', { backup: { defaultDir } })
    },

    async setBackupFormat(format: BackupFormat) {
      this.backupFormat = format
      await window.wslAPI.config.set('settings', { backup: { format } })
    },

    async setBackupKeepRecent(keepRecent: number) {
      this.backupKeepRecent = keepRecent
      await window.wslAPI.config.set('settings', { backup: { keepRecent } })
    },

    async setBackupAutoBeforeDestructive(autoBackupBeforeDestructive: boolean) {
      this.backupAutoBeforeDestructive = autoBackupBeforeDestructive
      await window.wslAPI.config.set('settings', { backup: { autoBackupBeforeDestructive } })
    },
  },
})
