import { defineStore } from 'pinia'
import type { AccentName, AppSettings, LogLevel } from '@wslpilot/shared'

const DEFAULTS = {
  accent: 'aurora',
  locale: 'system',
  reduceMotion: false,
  showRawCommand: false,
  confirmDestructive: true,
  logLevel: 'info',
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
  },
})
