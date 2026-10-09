import { defineStore } from 'pinia'
import type { DistroView, WslState } from '@wslpilot/shared'
import { toAppError, type AppError } from '@shared/errors'

export type DistroAction = 'start' | 'terminate' | 'setDefault' | 'shutdown' | 'refresh'

export const useDistrosStore = defineStore('distros', {
  state: () => ({
    items: [] as DistroView[],
    loading: false,
    lastError: null as AppError | null,
    busy: new Set<string>(),
    lastRefreshAt: 0,
  }),

  getters: {
    runningCount: (s) => s.items.filter((d) => d.state === 'Running').length,
    stoppedCount: (s) => s.items.filter((d) => d.state === 'Stopped').length,
    defaultDistro: (s) => s.items.find((d) => d.isDefault) ?? null,
    byName: (s) => (name: string) => s.items.find((d) => d.name === name) ?? null,
    pinned: (s) => s.items.filter((d) => d.meta?.pinned),
  },

  actions: {
    async refresh() {
      this.loading = true
      this.lastError = null
      try {
        this.items = await window.wslAPI.distros.list()
        this.lastRefreshAt = Date.now()
      } catch (e) {
        this.lastError = toAppError(e)
      } finally {
        this.loading = false
      }
    },

    async start(name: string) {
      await this.run(name, 'start', () => window.wslAPI.distros.start(name))
    },

    async terminate(name: string) {
      await this.run(name, 'terminate', () => window.wslAPI.distros.terminate(name))
    },

    async setDefault(name: string) {
      await this.run(name, 'setDefault', async () => {
        await window.wslAPI.distros.setDefault(name)
        for (const d of this.items) d.isDefault = d.name === name
      })
    },

    async shutdownAll() {
      this.busy.add('*')
      this.lastError = null
      try {
        await window.wslAPI.distros.shutdown()
        for (const d of this.items) {
          if (d.state !== 'Stopped') d.state = 'Stopped' as WslState
        }
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      } finally {
        this.busy.delete('*')
      }
    },

    async run(name: string, action: DistroAction, fn: () => Promise<void>) {
      const key = `${action}:${name}`
      this.busy.add(key)
      this.lastError = null
      try {
        await fn()
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      } finally {
        this.busy.delete(key)
      }
    },

    isBusy(name: string, action?: DistroAction) {
      if (action) return this.busy.has(`${action}:${name}`)
      return [...this.busy].some((k) => k.endsWith(`:${name}`) || k === name)
    },
  },
})
