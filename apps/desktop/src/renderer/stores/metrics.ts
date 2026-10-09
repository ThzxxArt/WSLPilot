import { defineStore } from 'pinia'
import {
  EMPTY_OVERVIEW,
  formatKb,
  formatKbPair,
  type OverviewMetrics,
  type Metrics,
} from '@wslpilot/shared'
import { toAppError, type AppError } from '@shared/errors'

/** 迷你趋势图采样点（保留最近 20 个） */
const MAX_POINTS = 20

export const useMetricsStore = defineStore('metrics', {
  state: () => ({
    overview: { ...EMPTY_OVERVIEW, perDistro: {} } as OverviewMetrics,
    loading: false,
    lastError: null as AppError | null,
    history: {
      cpu: [] as number[],
      mem: [] as number[],
      disk: [] as number[],
      running: [] as number[],
    },
  }),

  getters: {
    memLabel: (s) => formatKbPair(s.overview.memUsedKB, s.overview.memTotalKB),
    diskLabel: (s) => formatKbPair(s.overview.diskUsedKB, s.overview.diskTotalKB),
    cpuLabel: (s) => `${s.overview.cpuPercent}%`,
  },

  actions: {
    async sample() {
      this.loading = true
      this.lastError = null
      try {
        const raw = (await window.wslAPI.metrics.sampleOverview()) as OverviewMetrics
        if (raw && typeof raw === 'object' && 'runningCount' in raw) {
          this.overview = { ...raw, perDistro: raw.perDistro ?? {} }
          this.pushHistory(this.overview)
        }
      } catch (e) {
        this.lastError = toAppError(e)
      } finally {
        this.loading = false
      }
    },

    async sampleDistro(name: string): Promise<Metrics | null> {
      try {
        return (await window.wslAPI.metrics.sample(name)) as Metrics
      } catch {
        return null
      }
    },

    pushHistory(o: OverviewMetrics) {
      const memRatio = o.memTotalKB > 0 ? (o.memUsedKB / o.memTotalKB) * 100 : 0
      const diskRatio = o.diskTotalKB > 0 ? (o.diskUsedKB / o.diskTotalKB) * 100 : 0
      const push = (arr: number[], v: number) => {
        arr.push(v)
        if (arr.length > MAX_POINTS) arr.shift()
      }
      push(this.history.cpu, o.cpuPercent)
      push(this.history.mem, Math.round(memRatio))
      push(this.history.disk, Math.round(diskRatio))
      push(this.history.running, o.runningCount)
    },
  },
})

export { formatKb, formatKbPair }
