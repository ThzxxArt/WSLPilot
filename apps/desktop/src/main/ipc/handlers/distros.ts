import { join } from 'node:path'
import {
  CH,
  WSL_GLOBAL_LOCK,
  createAppError,
  exportFileName,
  type DistroView,
  type TaskHandle,
} from '@wslpilot/shared'
import type { WslService } from '../../services/wsl-service'
import type { RegistryService } from '../../services/registry-service'
import type { IoService } from '../../services/io-service'
import type { TaskRunner } from '../../services/task-runner'
import { sampleOverview } from '../../services/metrics-service'
import { createHostDiskReader } from '../../services/host-disk'
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
  deps: { wsl: WslService; registry: RegistryService; tasks: TaskRunner; io: IoService },
): void {
  const { wsl, registry, tasks, io } = deps
  /** 宿主磁盘读取器（30s TTL；注册期单例，跨轮询复用缓存） */
  const hostDisk = createHostDiskReader()

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
      const enriched = views.map((v) => {
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
      // 0.1.3：宿主磁盘占用（ext4.vhdx 文件大小；WSL1/文件缺失/权限不足降级 undefined）
      return await Promise.all(
        enriched.map(async (v) => {
          const size = await hostDisk.read(v.basePath)
          return size === undefined ? v : { ...v, hostDiskBytes: size }
        }),
      )
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
      // 发行版安装按名串行；「安装 WSL 本体」（无 name）与 WSL 更新/回滚共用全局锁 — 0.1.3
      lockKey: name ? `install:${name.toLowerCase()}` : WSL_GLOBAL_LOCK,
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

  /**
   * 稀疏磁盘（0.1.3）：`wsl --manage <name> --set-sparse <true|false>`。
   * 与同发行版 io 任务共用锁键（改动 vhdx/注册表，绝不与导出/迁移并发）。
   */
  add(CH.distrosSetSparse, (_c, arg: never): TaskHandle => {
    const o = arg as { name: string; sparse: boolean }
    return tasks.start({
      type: 'manage',
      distro: o.name,
      message: o.sparse ? `启用 ${o.name} 的稀疏磁盘` : `关闭 ${o.name} 的稀疏磁盘`,
      lockKey: o.name.toLowerCase(),
      run: (ctl) => wsl.setSparse(o.name, o.sparse, ctl),
    })
  })

  /**
   * 注销（0.1.3 任务化）：可选「注销前自动备份」（同一任务、同一排他锁内先导出再注销）；
   * 返回 TaskHandle，由渲染层跟踪终态（成功刷新 / 失败提示）。
   * 危险操作的二次确认仍由渲染层按 confirmDestructive 负责。
   */
  add(CH.distrosUnregister, (c, arg: never): TaskHandle => {
    const o = arg as { name: string; backupFirst: boolean }
    const target = assertName(o.name)
    const lower = target.toLowerCase()
    // 运行中任务（含无锁的终端动作）不得被注销强杀：先拒绝并给出可行动建议 —
    // 任务未启动前的检查（本 handler 自身开跑后不再匹配自己）
    const busy = tasks
      .list()
      .some((t) => t.status === 'running' && (t.distro ?? '').toLowerCase() === lower)
    if (busy) {
      throw createAppError('TASK_FAILED', {
        message: `发行版 ${target} 有运行中的任务，无法注销`,
        suggestion: '请等待任务完成，或先在任务抽屉中取消相关任务后重试',
      })
    }
    return tasks.start({
      type: 'unregister',
      distro: target,
      message: `注销 ${target}`,
      // 排他段（TOCTOU 双保险）：与同发行版 io 任务严格互斥
      lockKey: lower,
      run: async (ctl) => {
        ctl.throwIfCanceled()
        if (o.backupFirst) {
          const backup = c.configService.loadSync('settings').backup
          ctl.log(`注销前自动备份（可在设置中关闭）：${target}`)
          const path = join(io.resolveBackupDir(), exportFileName(target, backup.format))
          await io.runExport({ name: target, path, format: backup.format }, ctl)
          ctl.log('备份完成，开始注销')
          ctl.throwIfCanceled()
        }
        await wsl.unregister(target)
        ctl.report(100, `已注销 ${target}`)
      },
    })
  })
}
