import { defineStore } from 'pinia'
import {
  EMPTY_OVERVIEW,
  formatKbPair,
  toAppError,
  type AppError,
  type OverviewMetrics,
  type Metrics,
} from '@wslpilot/shared'

/** 迷你趋势图采样点（保留最近 20 个） */
const MAX_POINTS = 20

export const useMetricsStore = defineStore('metrics', {
  state: () => ({
    overview: { ...EMPTY_OVERVIEW, perDistro: {} } as OverviewMetrics,
    lastError: null as AppError | null,
    history: {
      // 只有 CPU 是速率型指标，趋势线有信息量；运行中/内存/磁盘是存量或离散计数，
      // 画趋势是平线噪声（review 迷你图滥用根治）——需要趋势的字段才进 history
      cpu: [] as number[],
    },
    /** 代际守卫：并发 sample 时只认最新一次发起的响应 */
    sampleGen: 0,
  }),

  getters: {
    memLabel: (s) => formatKbPair(s.overview.memUsedKB, s.overview.memTotalKB),
    diskLabel: (s) => formatKbPair(s.overview.diskUsedKB, s.overview.diskTotalKB),
    cpuLabel: (s) => `${s.overview.cpuPercent}%`,
  },

  actions: {
    async sample() {
      const gen = ++this.sampleGen
      this.lastError = null
      try {
        const raw = (await window.wslAPI.metrics.sampleOverview()) as OverviewMetrics
        if (gen !== this.sampleGen) return
        if (raw && typeof raw === 'object' && 'runningCount' in raw) {
          this.overview = { ...raw, perDistro: raw.perDistro ?? {} }
          this.pushHistory(this.overview)
        }
      } catch (e) {
        if (gen !== this.sampleGen) return
        this.lastError = toAppError(e)
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
      const push = (arr: number[], v: number) => {
        arr.push(v)
        if (arr.length > MAX_POINTS) arr.shift()
      }
      push(this.history.cpu, o.cpuPercent)
    },
  },
})
