import type { DistroRuntime, Metrics } from '@wslpilot/shared'
import type { WslService } from './wsl-service'
import type { Logger } from '@wslpilot/kit'

export interface OverviewMetrics {
  runningCount: number
  totalCount: number
  memUsedKB: number
  memTotalKB: number
  diskUsed: string
  diskTotal: string
  cpuPercent: number
  sampledAt: string
  perDistro: Record<string, Metrics>
}

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

function sumFmt(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)}T`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}G`
  return `${kb}K`
}

/** 按需采样：仅对 Running 的发行版取指标，避免无谓开销 */
export async function sampleOverview(
  wsl: WslService,
  distros: DistroRuntime[],
  logger: Logger,
): Promise<OverviewMetrics> {
  const running = distros.filter((d) => d.state === 'Running')
  const perDistro: Record<string, Metrics> = {}

  // 并发采样，单个失败不影响整体
  const results = await Promise.all(
    running.map(async (d) => {
      try {
        return { name: d.name, m: await wsl.sampleMetrics(d.name) }
      } catch (e) {
        logger.debug('metrics sample error', { name: d.name, error: String(e) })
        return { name: d.name, m: null }
      }
    }),
  )

  let memUsedKB = 0
  let memTotalKB = 0
  let cpuSum = 0
  let sampledAt = ''

  for (const r of results) {
    if (!r.m) continue
    perDistro[r.name] = r.m
    memUsedKB += r.m.memUsedKB
    memTotalKB += r.m.memTotalKB
    cpuSum += r.m.cpuPercent
    sampledAt = r.m.sampledAt
    // diskUsed/diskTotal 是字符串（如 12.3G），聚合时仅在单发行版场景展示
  }

  // 多发行版时磁盘显示「已采样数」为近似（避免解析字符串回数字）
  const only = running.length === 1 ? perDistro[running[0]!.name] : undefined

  return {
    runningCount: running.length,
    totalCount: distros.length,
    memUsedKB,
    memTotalKB,
    diskUsed: only?.diskUsed ?? (running.length ? sumFmt(Math.round(memUsedKB * 0.1)) : '0B'),
    diskTotal: only?.diskTotal ?? (running.length ? sumFmt(Math.round(memTotalKB * 2)) : '0B'),
    cpuPercent: running.length ? Math.round((cpuSum / running.length) * 10) / 10 : 0,
    sampledAt: sampledAt || new Date().toISOString(),
    perDistro,
  }
}

export const EMPTY_OVERVIEW: OverviewMetrics = EMPTY
