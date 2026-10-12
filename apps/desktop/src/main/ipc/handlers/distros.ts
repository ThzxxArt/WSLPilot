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
    // 大小写归一索引：WSL 名称不区分大小写，meta 命中必须同语义（review 根治 —
    // 此前精确键匹配会让大小写不一致的条目元数据静默丢失）
    const metaMap = new Map(metaFile.distros.map((d) => [d.name.toLowerCase(), d]))
    const views = await wsl.listWithMeta(metaMap)
    // 补齐 Lxss 深层信息（GUID/BasePath/DefaultUid）——`wsl -l -v` 本就不含这些字段。
    // 不补齐的话迁移向导会永远显示「注册表信息不可用」，而信息其实是可得的（review C-1）。
    // 失败降级不阻断（设计书 §9.2：读取失败降级为 undefined）。
    try {
      const deep = await registry.listAll()
      const byName = new Map(deep.map((d) => [d.name.toLowerCase(), d]))
      return views.map((v) => {
        // 发行版名不区分大小写（review M11）
        const extra = byName.get(v.name.toLowerCase())
        if (!extra) return v
        return {
          ...v,
          guid: extra.guid ?? v.guid,
          basePath: extra.basePath ?? v.basePath,
          defaultUid: extra.defaultUid ?? v.defaultUid,
        }
      })
    } catch (e) {
      c.logger.warn('registry enrich failed, deep info unavailable', { error: String(e) })
      return views
    }
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
    // M5 注册表详情：完整 Lxss 信息（GUID / BasePath / Flags / 原始键值）
    return registry.detailFull(assertName(name))
  })

  // metrics:sample — 单发行版语义（OverviewMetrics 已拆到 metrics:overview，禁 `*` 双返回形状）
  add(CH.metricsSample, async (_c, name: string) => {
    const n = assertName(name)
    if (n === '*') {
      throw createAppError('DISTRO_NOT_FOUND', {
        message: 'metrics:sample 只接受发行版名',
        suggestion: '全局概览请走 metrics:overview 通道',
      })
    }
    // 硬门禁（review：采样 `wsl -d X -e` 会隐式启动发行版）：未运行不采样
    await wsl.assertRunning(n)
    return wsl.sampleMetrics(n)
  })

  // metrics:overview — 全局概览（OverviewMetrics），无发行版入参
  add(CH.metricsOverview, async (c) => {
    const { sampleOverview } = await import('../../services/metrics-service')
    const distros = await wsl.list()
    return sampleOverview(wsl, distros, c.logger)
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
