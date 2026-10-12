import {
  EMPTY_OVERVIEW,
  formatKb,
  type DistroRuntime,
  type Metrics,
  type OverviewMetrics,
} from '@wslpilot/shared'
import type { WslService } from './wsl-service'
import type { Logger } from '@wslpilot/kit'

export type { OverviewMetrics }
export { EMPTY_OVERVIEW, formatKb }

/**
 * 按需采样：仅对 Running 的发行版取指标。
 * 磁盘/内存一律数值化累加，绝不推算伪造。
 */
export async function sampleOverview(
  wsl: WslService,
  distros: DistroRuntime[],
  logger: Logger,
): Promise<OverviewMetrics> {
  const running = distros.filter((d) => d.state === 'Running')
  const perDistro: Record<string, Metrics> = {}

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
  let diskUsedKB = 0
  let diskTotalKB = 0
  let cpuSum = 0
  let successCount = 0
  let sampledAt = ''
  let sampledAtMs = Number.NEGATIVE_INFINITY

  for (const r of results) {
    if (!r.m) continue
    successCount++
    perDistro[r.name] = r.m
    memUsedKB += r.m.memUsedKB
    memTotalKB += r.m.memTotalKB
    diskUsedKB += r.m.diskUsedKB
    diskTotalKB += r.m.diskTotalKB
    cpuSum += r.m.cpuPercent
    // review 0.1.2 根治：sampledAt 取所有成功样本中的**最新时刻**，
    // 而不是循环里最后一个成功样本的任意值（Promise.all 完成顺序与采样时刻无关）
    const atMs = Date.parse(r.m.sampledAt)
    if (Number.isFinite(atMs) && atMs > sampledAtMs) {
      sampledAtMs = atMs
      sampledAt = r.m.sampledAt
    }
  }

  return {
    runningCount: running.length,
    totalCount: distros.length,
    memUsedKB,
    memTotalKB,
    diskUsedKB,
    diskTotalKB,
    // CPU 均值口径：分母只含**采样成功**的发行版（失败样本既不进分子也不进分母，
    // 不以 0 顶替——否则失败会把整体 CPU 假性拉低）
    cpuPercent: successCount ? Math.round((cpuSum / successCount) * 10) / 10 : 0,
    sampledAt: sampledAt || new Date().toISOString(),
    perDistro,
  }
}
