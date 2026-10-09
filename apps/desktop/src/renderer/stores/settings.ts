import { defineStore } from 'pinia'
import type { AccentName, AppSettings, LogLevel } from '@wslpilot/shared'

const DEFAULTS = {
  accent: 'aurora',
  locale: 'system',
  reduceMotion: false,
  showRawCommand: false,
  confirmDestructive: true,
  logLevel: 'info',
  pollIntervalMs: 5000,
  closeBehavior: 'minimizeToTray' as 'minimizeToTray' | 'quit',
  terminalFontFamily: 'Cascadia Mono, Consolas, monospace',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalCursorStyle: 'block' as 'block' | 'underline' | 'bar',
  terminalCursorBlink: true,
  terminalScrollback: 5000,
} as const

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    loaded: false,
    accent: DEFAULTS.accent as AccentName,
    locale: DEFAULTS.locale as AppSettings['general']['locale'],
    reduceMotion: DEFAULTS.reduceMotion as boolean,
    showRawCommand: DEFAULTS.showRawCommand as boolean,
    confirmDestructive: DEFAULTS.confirmDestructive as boolean,
    logLevel: DEFAULTS.logLevel as LogLevel,
    pollIntervalMs: DEFAULTS.pollIntervalMs as number,
    closeBehavior: DEFAULTS.closeBehavior as AppSettings['general']['closeBehavior'],
    terminalFontFamily: DEFAULTS.terminalFontFamily as string,
    terminalFontSize: DEFAULTS.terminalFontSize as number,
    terminalLineHeight: DEFAULTS.terminalLineHeight as number,
    terminalCursorStyle: DEFAULTS.terminalCursorStyle as 'block' | 'underline' | 'bar',
    terminalCursorBlink: DEFAULTS.terminalCursorBlink as boolean,
    terminalScrollback: DEFAULTS.terminalScrollback as number,
    version: '',
  }),

  actions: {
    async load() {
      const s = (await window.wslAPI.config.get('settings')) as AppSettings
      this.accent = s.general.accent
      this.locale = s.general.locale
      this.reduceMotion = s.general.reduceMotion
      this.showRawCommand = s.advanced.showRawCommand
      this.confirmDestructive = s.advanced.confirmDestructive
      this.logLevel = s.advanced.logLevel
      this.pollIntervalMs = s.general.pollIntervalMs
      this.closeBehavior = s.general.closeBehavior
      this.terminalFontFamily = s.terminal.fontFamily
      this.terminalFontSize = s.terminal.fontSize
      this.terminalLineHeight = s.terminal.lineHeight
      this.terminalCursorStyle = s.terminal.cursorStyle
      this.terminalCursorBlink = s.terminal.cursorBlink
      this.terminalScrollback = s.terminal.scrollback
      this.version = await window.wslAPI.app.getVersion()
      this.loaded = true
    },

    async setAccent(accent: AccentName) {
      this.accent = accent
      await window.wslAPI.config.set('settings', { general: { accent } })
    },

    async setReduceMotion(reduceMotion: boolean) {
      this.reduceMotion = reduceMotion
      await window.wslAPI.config.set('settings', { general: { reduceMotion } })
    },

    async setShowRawCommand(showRawCommand: boolean) {
      this.showRawCommand = showRawCommand
      await window.wslAPI.config.set('settings', { advanced: { showRawCommand } })
    },

    async setConfirmDestructive(confirmDestructive: boolean) {
      this.confirmDestructive = confirmDestructive
      await window.wslAPI.config.set('settings', { advanced: { confirmDestructive } })
    },

    async setPollIntervalMs(pollIntervalMs: number) {
      this.pollIntervalMs = pollIntervalMs
      await window.wslAPI.config.set('settings', { general: { pollIntervalMs } })
    },

    async setCloseBehavior(closeBehavior: AppSettings['general']['closeBehavior']) {
      this.closeBehavior = closeBehavior
      await window.wslAPI.config.set('settings', { general: { closeBehavior } })
    },

    async setTerminalFontFamily(fontFamily: string) {
      this.terminalFontFamily = fontFamily
      await window.wslAPI.config.set('settings', { terminal: { fontFamily } })
    },

    async setTerminalFontSize(fontSize: number) {
      this.terminalFontSize = fontSize
      await window.wslAPI.config.set('settings', { terminal: { fontSize } })
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
  },
})
