import { CH, createAppError, type DistroView } from '@wslpilot/shared'
import type { WslService } from '../../services/wsl-service'
import type { RegistryService } from '../../services/registry-service'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  handler: (ctx: IpcContext, ...args: any[]) => Promise<unknown> | unknown,
) => void

function assertName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw createAppError('DISTRO_NOT_FOUND', { message: '缺少发行版名称' })
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
    // '*' 是全局概览保留键，不走发行版名校验
    if (name === '*') {
      const { sampleOverview } = await import('../../services/metrics-service')
      const distros = await wsl.list()
      return sampleOverview(wsl, distros, c.logger)
    }
    return wsl.sampleMetrics(assertName(name))
  })
}
