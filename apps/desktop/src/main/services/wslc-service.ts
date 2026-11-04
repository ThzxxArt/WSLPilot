/**
 * WSL 3 容器服务（wslc）— 容器/镜像/网络/卷/系统会话/设置。
 *
 * 安全边界：所有 argv 由 shared/containers 构建；渲染层只传结构化字段。
 * 流式命令（logs/events/pull/build）走 spawnTool，可取消；短命令走 runTool。
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
  buildContainerCopyArgs,
  buildContainerListArgs,
  buildContainerLogsArgs,
  buildContainerPruneArgs,
  buildContainerRemoveArgs,
  buildContainerRestartArgs,
  buildContainerRunArgs,
  buildContainerStartArgs,
  buildContainerStopArgs,
  buildEventsArgs,
  buildImageBuildArgs,
  buildImageListArgs,
  buildImagePruneArgs,
  buildImagePullArgs,
  buildImageRemoveArgs,
  buildNetworkConnectArgs,
  buildNetworkCreateArgs,
  buildNetworkDisconnectArgs,
  buildNetworkListArgs,
  buildNetworkPruneArgs,
  buildNetworkRemoveArgs,
  buildSessionListArgs,
  buildSessionTerminateArgs,
  buildStatsArgs,
  buildSystemInfoArgs,
  buildVolumeCreateArgs,
  buildVolumeListArgs,
  buildVolumePruneArgs,
  buildVolumeRemoveArgs,
  assertContainerRef,
  createAppError,
  parseContainerDetail,
  parseJsonList,
  parseContainerList,
  parseContainerTable,
  parseImageList,
  parseNetworks,
  parseSessionList,
  parseStats,
  parseSystemInfo,
  parseSystemInfoSessions,
  parseVolumes,
  previewWslcCommand,
  type ContainerDetail,
  type ContainerRunSpec,
  type ContainerStats,
  type ContainerSummary,
  type WslcCapabilities,
  type WslcImage,
  type WslcNetwork,
  type WslcSessionInfo,
  type WslcSettings,
  type WslcSystemInfo,
  type WslcVolume,
} from '@wslpilot/shared'
import { parse as parseYaml } from 'yaml'
import { atomicWrite, runTool, spawnTool, type Logger, type RunToolFn } from '@wslpilot/kit'
import type { TaskControl } from './task-runner'
import { probeWslcCapabilities } from './wslc-capabilities'

export interface WslcServiceDeps {
  logger: Logger
  runTool?: RunToolFn
  /** 测试注入流式执行（logs/events/pull/build） */
  spawnTool?: typeof spawnTool
  /** 测试注入 settings.yaml 路径 */
  settingsPath?: string
  /** 测试注入能力探测 */
  probe?: () => Promise<WslcCapabilities>
}

export interface WslcService {
  capabilities(force?: boolean): Promise<WslcCapabilities>
  invalidateCapabilities(): void
  systemInfo(): Promise<WslcSystemInfo>
  sessionList(): Promise<WslcSessionInfo[]>
  sessionTerminate(ctl?: TaskControl): Promise<void>
  listContainers(): Promise<ContainerSummary[]>
  inspectContainer(id: string): Promise<ContainerDetail | null>
  runContainer(spec: ContainerRunSpec, ctl: TaskControl): Promise<void>
  startContainer(id: string): Promise<void>
  stopContainer(id: string, timeoutSec?: number): Promise<void>
  restartContainer(id: string): Promise<void>
  removeContainer(id: string, force: boolean, ctl?: TaskControl): Promise<void>
  pruneContainers(ctl: TaskControl): Promise<void>
  logs(id: string, ctl: TaskControl, follow?: boolean): Promise<void>
  stats(): Promise<ContainerStats[]>
  copy(src: string, dst: string): Promise<void>
  listImages(): Promise<WslcImage[]>
  pullImage(ref: string, ctl: TaskControl): Promise<void>
  buildImage(tag: string, context: string, ctl: TaskControl): Promise<void>
  removeImage(ref: string): Promise<void>
  pruneImages(all: boolean, ctl: TaskControl): Promise<void>
  listNetworks(): Promise<WslcNetwork[]>
  createNetwork(
    name: string,
    opts?: { driver?: string; subnet?: string; gateway?: string },
  ): Promise<void>
  removeNetwork(name: string): Promise<void>
  connectNetwork(network: string, container: string): Promise<void>
  disconnectNetwork(network: string, container: string): Promise<void>
  pruneNetworks(ctl: TaskControl): Promise<void>
  listVolumes(): Promise<WslcVolume[]>
  createVolume(name: string): Promise<void>
  removeVolume(name: string): Promise<void>
  pruneVolumes(ctl: TaskControl): Promise<void>
  readSettings(): Promise<{ path: string; exists: boolean; content: string; model: WslcSettings }>
  writeSettings(content: string): Promise<{ path: string }>
  resetSettings(): Promise<void>
  /** 订阅 wslc events；返回停止函数。onExit 仅在「非主动停止」时回调（用于重连） */
  events(onLine: (line: string) => void, onExit?: (code: number) => void): { stop: () => void }
}

function settingsFilePath(injected?: string): string {
  if (injected) return injected
  const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  return join(base, 'wslc', 'settings.yaml')
}

function isMissingTool(text: string): boolean {
  return /ENOENT|not recognized|不是内部或外部命令|找不到.*wslc|no such file/i.test(text)
}

export function createWslcService(deps: WslcServiceDeps): WslcService {
  const logger = deps.logger
  const tool: RunToolFn = deps.runTool ?? runTool
  const spawn = deps.spawnTool ?? spawnTool
  const settingsPath = settingsFilePath(deps.settingsPath)
  const CAP_CACHE_MS = 60_000
  let capCache: { at: number; value: WslcCapabilities } | null = null

  function mapFailure(
    r: { stdout: string; stderr: string; code: number },
    raw: string,
    msg: string,
  ): never {
    const text = `${r.stderr}\n${r.stdout}`.trim()
    if (isMissingTool(text)) {
      throw createAppError('WSL_FEATURE_UNSUPPORTED', {
        message: '未检测到 wslc（WSL 容器 CLI）',
        detail: text,
        rawCommand: raw,
        suggestion: '请先在「设置 → WSL」更新 WSL（wsl --update）；WSL 容器需要 WSL 2.9.3+',
      })
    }
    throw createAppError('TASK_FAILED', {
      message: msg,
      detail: text,
      rawCommand: raw,
      suggestion: '请查看原始输出；必要时执行 wslc system info 检查容器会话状态',
    })
  }

  async function statusCapabilities(force = false): Promise<WslcCapabilities> {
    if (!force && capCache && Date.now() - capCache.at < CAP_CACHE_MS) return capCache.value
    const value = await (deps.probe ? deps.probe() : probeWslcCapabilities({ logger }))
    capCache = { at: Date.now(), value }
    return value
  }

  async function requireInstalled(): Promise<WslcCapabilities> {
    const caps = await statusCapabilities()
    if (!caps.installed) {
      throw createAppError('WSL_FEATURE_UNSUPPORTED', {
        message: '未检测到 wslc（WSL 容器 CLI）',
        suggestion: '请先在「设置 → WSL」更新 WSL（wsl --update）；WSL 容器需要 WSL 2.9.3+',
      })
    }
    return caps
  }

  async function runOk(args: string[], message: string): Promise<string> {
    const raw = previewWslcCommand(args)
    const r = await tool('wslc.exe', args, { timeoutMs: 120_000 })
    if (r.code !== 0) mapFailure(r, raw, message)
    if (r.truncated) {
      throw createAppError('TASK_FAILED', {
        message: `${message}：输出超过解析上限`,
        detail: 'wslc 输出超过 16MB，已拒绝把截断内容当作完整结果',
        rawCommand: raw,
      })
    }
    return r.stdout
  }

  function stream(args: string[], ctl: TaskControl, label: string): Promise<void> {
    const raw = previewWslcCommand(args)
    ctl.log(`$ ${raw}`)
    ctl.report(null, label)
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }
      const handle = spawn('wslc.exe', args, {
        onLine: (line) => ctl.log(line),
        onExit: (code) => {
          if (code === 0) finish(() => resolve())
          else if (ctl.isCanceled()) {
            finish(() => reject(createAppError('TASK_CANCELED', { message: `${label}已取消` })))
          } else {
            finish(() =>
              reject(
                createAppError('TASK_FAILED', {
                  message: `${label}失败（exit ${code}）`,
                  rawCommand: raw,
                  detail: '请查看任务日志中的 wslc 输出',
                }),
              ),
            )
          }
        },
        onError: (e) => {
          const err = createAppError('TASK_FAILED', {
            message: `${label}无法启动 wslc`,
            detail: e.message,
            rawCommand: raw,
            suggestion: '请确认 WSL 已更新且 wslc.exe 可用',
          })
          finish(() => reject(err))
        },
      })
      ctl.onCancel(() => handle.kill())
    })
  }

  async function readSettingsFile(): Promise<{
    path: string
    exists: boolean
    content: string
    model: WslcSettings
  }> {
    try {
      const content = await fs.readFile(settingsPath, 'utf8')
      let model: WslcSettings = { session: {} }
      try {
        const parsed = parseYaml(content)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          model = parsed as WslcSettings
        }
      } catch {
        /* 原始内容返回，模型为空；保存时会再次校验 */
      }
      return { path: settingsPath, exists: true, content, model }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path: settingsPath, exists: false, content: '', model: { session: {} } }
      }
      throw createAppError('IO_ERROR', {
        message: '读取 wslc settings.yaml 失败',
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return {
    capabilities: statusCapabilities,
    invalidateCapabilities: () => {
      capCache = null
    },
    async systemInfo() {
      const caps = await requireInstalled()
      if (!caps.systemInfo) {
        // 旧版 wslc 没有 system info：用容器数量给出可用的降级信息
        const out = await runOk(buildContainerListArgs(true, caps.jsonLists), '读取容器列表失败')
        const parsed = parseContainerList(out)
        const count =
          parsed.length > 0 || /^\s*\[/m.test(out) ? parsed.length : parseContainerTable(out).length
        return { version: caps.version, raw: `containers=${count}` }
      }
      const out = await runOk(buildSystemInfoArgs(caps.jsonLists), '读取容器系统信息失败')
      const rows = parseJsonList(out)
      return parseSystemInfo(rows[0] ?? out)
    },
    async sessionList() {
      const caps = await requireInstalled()
      if (!caps.session) return []
      // 3.0.3 的 `system session list` 不支持 --format json；改读 system info 的
      // Server.Sessions（同一事实源，且能拿到 Version/SettingsFile）。
      try {
        const out = await runOk(buildSystemInfoArgs(true), '读取容器会话失败')
        const parsed = parseSystemInfoSessions(out)
        if (parsed.length > 0) return parsed
      } catch {
        /* 旧版没有 Server.Sessions：走表格兜底 */
      }
      const table = await runOk(buildSessionListArgs(false), '读取容器会话失败')
      return parseSessionList(table)
    },
    async sessionTerminate(ctl) {
      const caps = await requireInstalled()
      if (!caps.session) {
        throw createAppError('WSL_FEATURE_UNSUPPORTED', {
          message: '当前 wslc 版本不支持容器会话管理',
          suggestion: '请更新 WSL 后重试（wsl --update）',
        })
      }
      const c = ctl ?? {
        taskId: 'wslc-session',
        type: 'wslc-session' as const,
        report: () => {},
        log: () => {},
        isCanceled: () => false,
        throwIfCanceled: () => {},
        onCancel: () => {},
      }
      await stream(buildSessionTerminateArgs(), c, '终止容器会话')
    },
    async listContainers() {
      const caps = await requireInstalled()
      const out = await runOk(buildContainerListArgs(true, caps.jsonLists), '读取容器列表失败')
      const json = parseContainerList(out)
      if (json.length > 0 || /^\s*[[{]/.test(out)) return json
      return parseContainerTable(out)
    },
    async inspectContainer(id) {
      await requireInstalled()
      const safeId = assertContainerRef(id)
      const raw = previewWslcCommand(['container', 'inspect', safeId])
      const r = await tool('wslc.exe', ['container', 'inspect', safeId], { timeoutMs: 30_000 })
      if (r.code !== 0) mapFailure(r, raw, '读取容器详情失败')
      if (r.truncated) {
        throw createAppError('TASK_FAILED', {
          message: '容器详情输出过大，无法解析',
          rawCommand: raw,
        })
      }
      const rows = parseJsonList(r.stdout)
      const value = rows[0] ?? null
      return value ? parseContainerDetail(value) : null
    },
    async runContainer(spec, ctl) {
      await requireInstalled()
      if (spec.pull) {
        await stream(buildImagePullArgs(spec.image), ctl, `拉取镜像 ${spec.image}`)
      }
      const args = buildContainerRunArgs(spec)
      await stream(args, ctl, `运行容器 ${spec.name ?? spec.image}`)
    },
    async startContainer(id) {
      await requireInstalled()
      await runOk(buildContainerStartArgs(id), `启动容器 ${id} 失败`)
    },
    async stopContainer(id, timeoutSec) {
      await requireInstalled()
      await runOk(buildContainerStopArgs(id, timeoutSec), `停止容器 ${id} 失败`)
    },
    async restartContainer(id) {
      await requireInstalled()
      await runOk(buildContainerRestartArgs(id), `重启容器 ${id} 失败`)
    },
    async removeContainer(id, force, ctl) {
      await requireInstalled()
      if (!ctl) {
        await runOk(buildContainerRemoveArgs(id, force), `删除容器 ${id} 失败`)
        return
      }
      await stream(buildContainerRemoveArgs(id, force), ctl, `删除容器 ${id}`)
    },
    async pruneContainers(ctl) {
      await requireInstalled()
      await stream(buildContainerPruneArgs(), ctl, '清理已停止容器')
    },
    async logs(id, ctl, follow = false) {
      await requireInstalled()
      await stream(buildContainerLogsArgs(id, follow), ctl, `读取容器 ${id} 日志`)
    },
    async stats() {
      const caps = await requireInstalled()
      if (!caps.jsonStats) return []
      const out = await runOk(buildStatsArgs(true, true), '读取容器统计失败')
      return parseStats(out)
    },
    async copy(src, dst) {
      await requireInstalled()
      await runOk(buildContainerCopyArgs(src, dst), '复制容器文件失败')
    },
    async listImages() {
      const caps = await requireInstalled()
      const out = await runOk(buildImageListArgs(caps.jsonLists), '读取镜像列表失败')
      return parseImageList(out)
    },
    async pullImage(ref, ctl) {
      await requireInstalled()
      await stream(buildImagePullArgs(ref), ctl, `拉取镜像 ${ref}`)
    },
    async buildImage(tag, context, ctl) {
      await requireInstalled()
      await stream(buildImageBuildArgs(tag, context), ctl, `构建镜像 ${tag}`)
    },
    async removeImage(ref) {
      await requireInstalled()
      await runOk(buildImageRemoveArgs(ref), `删除镜像 ${ref} 失败`)
    },
    async pruneImages(all, ctl) {
      await requireInstalled()
      await stream(buildImagePruneArgs(all), ctl, '清理镜像')
    },
    async listNetworks() {
      const caps = await requireInstalled()
      if (!caps.networks) return []
      const out = await runOk(buildNetworkListArgs(caps.jsonLists), '读取网络列表失败')
      return parseNetworks(out)
    },
    async createNetwork(name, opts) {
      await requireInstalled()
      await runOk(buildNetworkCreateArgs(name, opts), `创建网络 ${name} 失败`)
    },
    async removeNetwork(name) {
      await requireInstalled()
      await runOk(buildNetworkRemoveArgs(name), `删除网络 ${name} 失败`)
    },
    async connectNetwork(network, container) {
      await requireInstalled()
      await runOk(buildNetworkConnectArgs(network, container), '连接容器网络失败')
    },
    async disconnectNetwork(network, container) {
      await requireInstalled()
      await runOk(buildNetworkDisconnectArgs(network, container), '断开容器网络失败')
    },
    async pruneNetworks(ctl) {
      await requireInstalled()
      await stream(buildNetworkPruneArgs(), ctl, '清理网络')
    },
    async listVolumes() {
      const caps = await requireInstalled()
      if (!caps.volumes) return []
      const out = await runOk(buildVolumeListArgs(caps.jsonLists), '读取卷列表失败')
      return parseVolumes(out)
    },
    async createVolume(name) {
      await requireInstalled()
      await runOk(buildVolumeCreateArgs(name), `创建卷 ${name} 失败`)
    },
    async removeVolume(name) {
      await requireInstalled()
      await runOk(buildVolumeRemoveArgs(name), `删除卷 ${name} 失败`)
    },
    async pruneVolumes(ctl) {
      await requireInstalled()
      await stream(buildVolumePruneArgs(), ctl, '清理卷')
    },
    readSettings: readSettingsFile,
    async writeSettings(content) {
      const text = String(content ?? '')
      try {
        const parsed = parseYaml(text)
        if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          throw new Error('settings.yaml 顶层必须是对象')
        }
      } catch (e) {
        throw createAppError('CONFIG_INVALID', {
          message: 'wslc settings.yaml 不是合法 YAML',
          detail: e instanceof Error ? e.message : String(e),
        })
      }
      await fs.mkdir(dirname(settingsPath), { recursive: true }).catch(() => {})
      // 备份轮转（保留 3 份）：写坏可回滚，且不阻塞保存
      try {
        await fs.access(settingsPath)
        for (let i = 2; i >= 1; i--) {
          await fs.rm(`${settingsPath}.bak${i + 1}`, { force: true }).catch(() => {})
          await fs.rename(`${settingsPath}.bak${i}`, `${settingsPath}.bak${i + 1}`).catch(() => {})
        }
        await fs.copyFile(settingsPath, `${settingsPath}.bak1`)
      } catch {
        /* 首次保存无旧文件 */
      }
      await atomicWrite(settingsPath, text)
      logger.info('wslc settings written', { path: settingsPath })
      return { path: settingsPath }
    },
    async resetSettings() {
      await requireInstalled()
      await runOk(['settings', 'reset'], '重置 wslc settings.yaml 失败')
    },
    events(onLine, onExit) {
      let stopped = false
      let exited = false
      const notifyExit = (code: number) => {
        if (stopped || exited) return
        exited = true
        onExit?.(code)
      }
      const handle = spawn('wslc.exe', buildEventsArgs(), {
        onLine,
        onExit: notifyExit,
        onError: (e) => {
          logger.warn('wslc events error', { error: e.message })
          // spawn 级错误（ENOENT 等）不会触发 onExit：显式通知重连调度
          notifyExit(-1)
        },
      })
      return {
        stop: () => {
          stopped = true
          handle.kill()
        },
      }
    },
  }
}
