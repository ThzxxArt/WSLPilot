import { defineStore } from 'pinia'
import type { OverviewMetrics, Metrics } from '@wslpilot/shared'
import { toAppError, type AppError } from '@shared/errors'

const EMPTY: OverviewMetrics = {
  runningCount: 0,
  totalCount: 0,
  memUsedKB: 0,
  memTotalKB: 0,
  diskUsed: '0B',
  diskTotal: '0B',
  cpuPercent: 0,
  sampledAt: '',
  perDistro: {},
}

/** 迷你趋势图采样点（保留最近 20 个） */
const MAX_POINTS = 20

export const useMetricsStore = defineStore('metrics', {
  state: () => ({
    overview: { ...EMPTY } as OverviewMetrics,
    loading: false,
    lastError: null as AppError | null,
    history: {
      cpu: [] as number[],
      mem: [] as number[],
      disk: [] as number[],
      running: [] as number[],
    },
  }),

  actions: {
    async sample() {
      this.loading = true
      this.lastError = null
      try {
        const raw = (await window.wslAPI.metrics.sample('*')) as unknown as OverviewMetrics
        if (raw && typeof raw === 'object' && 'runningCount' in raw) {
          this.overview = raw
          this.pushHistory(raw)
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
      const push = (arr: number[], v: number) => {
        arr.push(v)
        if (arr.length > MAX_POINTS) arr.shift()
      }
      push(this.history.cpu, o.cpuPercent)
      push(this.history.mem, Math.round(memRatio))
      push(this.history.running, o.runningCount)
    },
  },
})
