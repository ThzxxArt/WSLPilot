import { CH, type DistroView } from '@wslpilot/shared'
import type { WslService } from '../../services/wsl-service'
import type { RegistryService } from '../../services/registry-service'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  handler: (ctx: IpcContext, ...args: any[]) => Promise<unknown> | unknown,
) => void

function assertName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('缺少发行版名称')
  }
  return name.trim()
}

export function registerDistroHandlers(
  add: AddFn,
  _ctx: IpcContext,
  deps: { wsl: WslService; registry: RegistryService },
): void {
  const { wsl, registry } = deps

  add(CH.distrosList, async (c): Promise<DistroView[]> => {
    // 合并 distros.jsonc 元数据
    const metaFile = await c.configService.load('distros')
    const metaMap = new Map(metaFile.distros.map((d) => [d.name, d]))
    return wsl.listWithMeta(metaMap)
  })

  add(CH.distrosStart, async (_c, name: string) => {
    await wsl.start(assertName(name))
  })

  add(CH.distrosTerminate, async (_c, name: string) => {
    await wsl.terminate(assertName(name))
  })

  add(CH.distrosShutdown, async () => {
    await wsl.shutdown()
  })

  add(CH.distrosSetDefault, async (_c, name: string) => {
    await wsl.setDefault(assertName(name))
  })

  add(CH.registryDetail, async (_c, name: string) => {
    return registry.detail(assertName(name))
  })

  add(CH.metricsSample, async (c, name: string) => {
    if (name === '*') {
      // 全局概览：设计书驾驶舱指标卡
      const { sampleOverview } = await import('../../services/metrics-service')
      const distros = await wsl.list()
      return sampleOverview(wsl, distros, c.logger)
    }
    return wsl.sampleMetrics(assertName(name))
  })
}
