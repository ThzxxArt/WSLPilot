import { CH, createAppError, type DistroView, type TaskHandle } from '@wslpilot/shared'
import type { WslService } from '../../services/wsl-service'
import type { RegistryService } from '../../services/registry-service'
import type { TaskRunner } from '../../services/task-runner'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
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
  deps: { wsl: WslService; registry: RegistryService; tasks: TaskRunner },
): void {
  const { wsl, registry, tasks } = deps

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

  add(CH.distrosListOnline, async () => {
    return wsl.listOnline()
  })

  // 长任务：安装 / 版本转换，进度经 task:progress 推送
  add(CH.distrosInstall, (_c, arg: never): TaskHandle => {
    const o = (arg ?? {}) as { name?: string }
    const name = o.name?.trim() || undefined
    return tasks.start({
      type: 'install',
      distro: name,
      message: name ? `安装 ${name}` : '安装 WSL',
      lockKey: name ? `install:${name.toLowerCase()}` : 'install:*',
      run: (ctl) => wsl.install(name, ctl),
    })
  })

  add(CH.distrosSetVersion, (_c, arg: never): TaskHandle => {
    const o = arg as { name: string; version: 1 | 2 }
    return tasks.start({
      type: 'convert',
      distro: o.name,
      message: `转换 ${o.name} 到 WSL${o.version}`,
      lockKey: o.name.toLowerCase(),
      run: (ctl) => wsl.setVersion(o.name, o.version, ctl),
    })
  })

  // 危险操作：仅执行，二次确认由渲染层按 confirmDestructive 负责
  add(CH.distrosUnregister, async (_c, name: string) => {
    await wsl.unregister(assertName(name))
  })
}
