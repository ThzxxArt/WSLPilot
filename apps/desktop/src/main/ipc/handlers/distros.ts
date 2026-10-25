import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import {
  CH,
  WSL_GLOBAL_LOCK,
  createAppError,
  exportFileName,
  formatBytes,
  wslSizeToBytes,
  type DistroInstallOptions,
  type DistroView,
  type TaskHandle,
} from '@wslpilot/shared'
import type { WslService } from '../../services/wsl-service'
import type { RegistryService } from '../../services/registry-service'
import type { IoService } from '../../services/io-service'
import type { TaskRunner } from '../../services/task-runner'
import { sampleOverview } from '../../services/metrics-service'
import { createHostDiskReader } from '../../services/host-disk'
import { readVhdxVirtualSize } from '../../services/vhdx'
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

/** 同发行版长任务运行中：直接 start/terminate/setDefault 必须拒绝，不能把任务打断在半路 */
function assertNoTaskForDistro(tasks: TaskRunner, name: string): void {
  const busy = tasks.runningForDistro(name)
  if (busy.length === 0) return
  throw createAppError('TASK_FAILED', {
    message: `发行版 ${name} 有运行中的任务，无法执行该操作`,
    detail: busy.map((t) => `${t.type}: ${t.message}`).join('\n'),
    suggestion: '请等待任务完成，或先在任务抽屉中取消相关任务后重试',
  })
}

/** 全局关机：任何运行中任务都可能被 --shutdown 打断，必须全部列出并拒绝 */
function assertNoRunningTasks(tasks: TaskRunner): void {
  const busy = tasks.running()
  if (busy.length === 0) return
  throw createAppError('TASK_FAILED', {
    message: '有运行中的任务，无法全局关机',
    detail: busy.map((t) => `${t.type}${t.distro ? ` ${t.distro}` : ''}: ${t.message}`).join('\n'),
    suggestion: '请等待任务完成，或先在任务抽屉中取消相关任务后重试',
  })
}

export function registerDistroHandlers(
  add: AddFn,
  _ctx: IpcContext,
  deps: { wsl: WslService; registry: RegistryService; tasks: TaskRunner; io: IoService },
): void {
  const { wsl, registry, tasks, io } = deps
  /** 宿主磁盘读取器（30s TTL；注册期单例，跨轮询复用缓存） */
  const hostDisk = createHostDiskReader()

  /** 压缩前后读真实 vhdx 大小：不经过 30s 缓存，否则 before/after 必然相同 */
  async function freshVhdxSize(name: string): Promise<number | undefined> {
    try {
      const d = await registry.detail(name)
      if (!d.basePath) return undefined
      return (await fs.stat(join(d.basePath, 'ext4.vhdx'))).size
    } catch {
      return undefined
    }
  }

  /** 读 VHDX 虚拟容量（不是物理文件大小）：resize 只允许 > 当前值 */
  async function freshVhdxVirtualSize(name: string): Promise<number | undefined> {
    try {
      const d = await registry.detail(name)
      if (!d.basePath) return undefined
      return await readVhdxVirtualSize(join(d.basePath, 'ext4.vhdx'))
    } catch {
      return undefined
    }
  }

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
    const target = assertName(name)
    assertNoTaskForDistro(tasks, target)
    await tasks.withLock(target.toLowerCase(), () => wsl.start(target))
  })

  add(CH.distrosTerminate, async (_c, name: string) => {
    const target = assertName(name)
    // 导出/迁移/压缩正在跑时 terminate 会把它们打断：直接拒绝并列出任务
    assertNoTaskForDistro(tasks, target)
    await tasks.withLock(target.toLowerCase(), () => wsl.terminate(target))
  })

  add(CH.distrosShutdown, async () => {
    // 先关闭新任务入口，再检查/执行；否则 check 与 wsl --shutdown 之间可插入导出任务。
    tasks.beginShutdown()
    try {
      assertNoRunningTasks(tasks)
      await tasks.withLock(
        WSL_GLOBAL_LOCK,
        () => {
          assertNoRunningTasks(tasks)
          return wsl.shutdown()
        },
        { allowDuringShutdown: true },
      )
    } finally {
      tasks.endShutdown()
    }
  })

  add(CH.distrosSetDefault, async (_c, name: string) => {
    const target = assertName(name)
    assertNoTaskForDistro(tasks, target)
    await tasks.withLock(target.toLowerCase(), () => wsl.setDefault(target))
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
    const raw = (arg ?? {}) as DistroInstallOptions
    const name = raw.name?.trim() || undefined
    // 统一形状（测试/handler 直接调用时也不把 undefined 透传给服务层）
    const o: DistroInstallOptions = {
      name,
      ...(raw.location ? { location: raw.location } : {}),
      ...(raw.version ? { version: raw.version } : {}),
      enableWsl1: raw.enableWsl1 === true,
      ...(raw.vhdSize ? { vhdSize: raw.vhdSize } : {}),
      fixedVhd: raw.fixedVhd === true,
      webDownload: raw.webDownload === true,
    }
    return tasks.start({
      type: 'install',
      distro: name,
      message: name ? `安装 ${name}` : '安装 WSL',
      // 所有 install 都改 WSL 本体状态（全局默认版本/组件/Store 源），必须与
      // `wsl --update`、`--set-default-version` 共用全局锁；只按 name 加锁会留下
      // “装 Ubuntu 的同时更新/改默认版本”的竞态窗口。
      lockKey: WSL_GLOBAL_LOCK,
      run: (ctl) => wsl.install(name, ctl, o),
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
   * 压缩磁盘（0.1.4）：`wsl --manage <name> --compact`。
   * WSL 会终止运行中发行版：terminateFirst 由 UI 显式确认后传入。
   */
  add(CH.distrosCompact, (_c, arg: never): TaskHandle => {
    const o = arg as { name: string; terminateFirst: boolean }
    const target = assertName(o.name)
    return tasks.start({
      type: 'manage',
      distro: target,
      message: `压缩 ${target} 的虚拟磁盘`,
      lockKey: target.toLowerCase(),
      run: async (ctl) => {
        const before = await freshVhdxSize(target)
        await wsl.compact(target, o.terminateFirst === true, ctl)
        const after = await freshVhdxSize(target)
        if (before !== undefined && after !== undefined) {
          const reclaimed = before - after
          ctl.log(
            `宿主 vhdx：${formatBytes(before)} → ${formatBytes(after)}` +
              (reclaimed > 0 ? `（回收 ${formatBytes(reclaimed)}）` : '（未测得回收）'),
          )
          ctl.report(
            100,
            reclaimed > 0
              ? `压缩完成：${target} · 回收 ${formatBytes(reclaimed)}`
              : `压缩完成：${target} · 未测得回收（WSL 可能仍占用虚拟磁盘）`,
          )
        }
      },
    })
  })

  /** 调整磁盘（0.1.4）：WSL --resize 实际可缩容；这里用虚拟容量硬门禁保证只增 */
  add(CH.distrosResize, (_c, arg: never): TaskHandle => {
    const o = arg as { name: string; size: string }
    const target = assertName(o.name)
    return tasks.start({
      type: 'manage',
      distro: target,
      message: `扩容 ${target} 到 ${o.size}`,
      lockKey: target.toLowerCase(),
      run: async (ctl) => {
        const requested = wslSizeToBytes(o.size)
        const current = await freshVhdxVirtualSize(target)
        if (requested === null || current === undefined) {
          throw createAppError('TASK_FAILED', {
            message: '无法读取当前虚拟磁盘容量，已中止扩容',
            detail:
              requested === null
                ? `无法解析目标大小：${o.size}`
                : 'VHDX 元数据不可读或路径不可访问',
            suggestion: '请确认发行版已停止、ext4.vhdx 可访问后重试；不支持缩容',
          })
        }
        if (requested <= current) {
          throw createAppError('INVALID_ARGUMENT', {
            message: `目标大小必须大于当前虚拟磁盘（${formatBytes(current)}）`,
            detail: `当前 ${current} 字节，目标 ${requested} 字节；WSL 的 --resize 在小目标时会缩容`,
            suggestion: '请输入更大的容量（如更大一号的 GB/TB）；本应用不支持缩容',
          })
        }
        await wsl.resize(target, o.size, ctl)
      },
    })
  })

  /** 设置默认用户（0.1.4）：`wsl --manage <name> --set-default-user <user>` */
  add(CH.distrosSetDefaultUser, (_c, arg: never): TaskHandle => {
    const o = arg as { name: string; user: string }
    const target = assertName(o.name)
    return tasks.start({
      type: 'manage',
      distro: target,
      message: `设置 ${target} 的默认用户为 ${o.user}`,
      lockKey: target.toLowerCase(),
      run: (ctl) => wsl.setDefaultUser(target, o.user, ctl),
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
    const busy = tasks.runningForDistro(target)
    if (busy.length > 0) {
      throw createAppError('TASK_FAILED', {
        message: `发行版 ${target} 有运行中的任务，无法注销`,
        detail: busy.map((t) => `${t.type}: ${t.message}`).join('\n'),
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
          // 用户已经确认“永久删除该发行版”，备份是其安全网；若发行版正在运行，
          // 必须先终止才能导出（0.1.4 的 runExport 不再隐式杀会话）。
          ctl.log('备份前会先终止该发行版（注销本身也会删除它）')
          await io.runExport(
            { name: target, path, format: backup.format, terminateFirst: true },
            ctl,
          )
          ctl.log('备份完成，开始注销')
          ctl.throwIfCanceled()
        }
        await wsl.unregister(target)
        ctl.report(100, `已注销 ${target}`)
      },
    })
  })
}
