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
          // review 0.1.2 审计修复：成功路径清除错误态，让采样失败可自愈（并发失败穿插也不例外）
          this.lastError = null
        }
      } catch (e) {
        if (gen !== this.sampleGen) return
        this.lastError = toAppError(e)
      }
    },

    /**
     * 单发行版采样（review 0.1.2 根治）：
     * - 未运行（DISTRO_NOT_RUNNING）是预期状态而非故障：静默返回 null，不污染 lastError；
     * - 其他失败（采样失败）必须落 lastError，不再一律静默 null 让错误无出口；
     * - 成功清除 lastError（review 0.1.2 审计修复）：否则一次失败写全局状态后无自愈出口，
     *   StatusBar/Dashboard 会永久显示「服务异常」。
     */
    async sampleDistro(name: string): Promise<Metrics | null> {
      try {
        const metrics = (await window.wslAPI.metrics.sample(name)) as Metrics
        this.lastError = null
        return metrics
      } catch (e) {
        const err = toAppError(e)
        if (err.code !== 'DISTRO_NOT_RUNNING') this.lastError = err
        return null
      }
    },

    pushHistory(o: OverviewMetrics) {
      // 无 Running 发行版时主进程给不出样本，cpuPercent 恒 0：
      // push 0 会在趋势图上制造「假下探」（review 0.1.2 根治 — 冻结 history 不造假）
      if (o.runningCount <= 0) return
      const push = (arr: number[], v: number) => {
        arr.push(v)
        if (arr.length > MAX_POINTS) arr.shift()
      }
      push(this.history.cpu, o.cpuPercent)
    },
  },
})
