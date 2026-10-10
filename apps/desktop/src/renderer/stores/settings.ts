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
    /** 落盘失败时间戳：界面监听它给出一次性提示（review M-3） */
    persistErrorAt: 0,
    version: '',
  }
}

type SettingsState = ReturnType<typeof initialState>

export const useSettingsStore = defineStore('settings', {
  state: initialState,

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
        this.autoUpdate = s.advanced.autoUpdate
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
    },

    /**
     * 乐观更新 + 失败回滚的统一落盘入口（review M-3 根治）。
     * 早期 21 个 setter 都是「先改 state 再 await config.set，不 catch」——
     * 落盘失败时开关显示已改、settings.jsonc 未改，重启后悄悄回滚，用户完全不知情。
     * 现在：失败回滚 UI 值 + 记录 lastError + 推进 persistErrorAt 供界面提示。
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
      try {
        await window.wslAPI.config.set('settings', patch)
        return true
      } catch (e) {
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
