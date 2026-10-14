import type {
  DistroMeta,
  DistroRuntime,
  DistroView,
  ElevationOpResult,
  ElevationRequest,
  Metrics,
  OnlineDistro,
  WslEnvInfo,
  WslState,
} from '@wslpilot/shared'
import {
  buildSetDefaultVersionArgs,
  buildSetSparseArgs,
  buildUpdateArgs,
  buildUpdateRollbackArgs,
  createAppError,
  assertSafeDistroName,
  isElevationError,
  ELEVATION_OP_LABEL,
  ELEVATION_SUGGESTION,
  DISTRO_BRAND_COLORS,
} from '@wslpilot/shared'
import { runWsl, parseDistroList, getRawCommand, type Logger } from '@wslpilot/kit'
import type { TaskControl } from './task-runner'
import { spawnWslTask } from './spawn-task'

/** wsl 状态字符串 → 规范化 WslState */
export function normalizeState(raw: string): WslState {
  const s = raw.trim().toLowerCase()
  if (!s) return 'Unknown'
  if (s.includes('running') || s.includes('运行')) return 'Running'
  if (s.includes('stopped') || s.includes('停止')) return 'Stopped'
  if (s.includes('installing') || s.includes('安装')) return 'Installing'
  if (s.includes('uninstalling') || s.includes('卸载')) return 'Uninstalling'
  if (s.includes('converting') || s.includes('转换')) return 'Converting'
  return 'Unknown'
}

/**
 * 在 `wsl --list` 输出中精确查找发行版（大小写不敏感，WSL 名称语义）。
 * 必须按解析后的名单精确比对：子串匹配会把 `Ubuntu-22.04` 误判为 `Ubuntu` 已注册，
 * 导致安装任务在真正开始前假结算（review 根治）。
 *
 * 兼容两种真实输出形态（同一函数是唯一解析入口）：
 * - `wsl --list --verbose` 表格：`parseDistroList` 提取 NAME 列
 * - `wsl --list` 简单列表：逐行剥默认标记/「(默认)(Default)」后缀后精确比对
 *   （真实输出形如 `Ubuntu-22.04 (Default)` / `Ubuntu-22.04（默认）`）
 */
export function listContainsDistro(stdout: string, target: string): boolean {
  const lower = String(target ?? '')
    .trim()
    .toLowerCase()
  if (!lower) return false
  if (parseDistroList(stdout).some((d) => d.name.toLowerCase() === lower)) return true
  // 简单列表形态兜底（原实现用整段子串匹配，既有前缀误判又依赖输出形态；此处逐行精确比对）
  for (const rawLine of String(stdout ?? '').split(/\r?\n/)) {
    let line = rawLine.replace(/^\uFEFF/, '').trim()
    if (!line) continue
    if (/[:：]$/.test(line)) continue // 说明行（如「适用于 Linux 的 Windows 子系统分发版:」）
    if (line.startsWith('*')) line = line.slice(1).trim()
    line = line.replace(/\s*[（(]\s*(默认|default)\s*[)）]\s*$/i, '').trim()
    if (line.toLowerCase() === lower) return true
  }
  return false
}

export interface WslStatus {
  raw: string
  wslVersion: string
  kernelVersion: string
}

/**
 * `wsl --status` 全量字段解析（0.1.3 — 环境体检）。
 * 中英文输出兼容；解析不到的字段如实为空（绝不伪造）。
 */
export function parseWslStatus(raw: string): {
  defaultDistro: string
  defaultVersion: 1 | 2 | null
  kernelVersion: string
} {
  const text = String(raw ?? '')
  const distro =
    /(?:默认分发(?:版)?|默认发行版|Default Distribution)\s*[:：]\s*([^\r\n]+)/i
      .exec(text)?.[1]
      ?.trim() ?? ''
  const verRaw = /(?:默认版本|Default Version)\s*[:：]\s*([^\r\n]+)/i.exec(text)?.[1]?.trim() ?? ''
  const versionNum = /(\d+)/.exec(verRaw)?.[1]
  const defaultVersion: 1 | 2 | null = versionNum === '1' ? 1 : versionNum === '2' ? 2 : null
  const kernelVersion =
    /(?:内核版本|Kernel version)\s*[:：]\s*([^\r\n]+)/i.exec(text)?.[1]?.trim() ?? ''
  return { defaultDistro: distro, defaultVersion, kernelVersion }
}

/** 安装/更新输出中的「需要重启 Windows」提示识别（中英文） */
const RESTART_REQUIRED_RE = /restart|reboot|重新启动|重启/i

export interface WslService {
  list(): Promise<DistroRuntime[]>
  listWithMeta(metaByName: Map<string, DistroMeta>): Promise<DistroView[]>
  /**
   * 运行状态硬门禁（review：跑命令绝不隐式启动发行版）。
   * `wsl -d X -e …` 会把停着的发行版拉起来——一切「进发行版跑命令」的入口必须先过此闸。
   */
  assertRunning(name: string): Promise<void>
  start(name: string): Promise<void>
  terminate(name: string): Promise<void>
  shutdown(): Promise<void>
  setDefault(name: string): Promise<void>
  getVersion(): Promise<WslStatus>
  /** 采样单个运行中发行版的资源指标（未运行由门禁拒绝） */
  sampleMetrics(name: string): Promise<Metrics>
  /**
   * WSL 环境体检（0.1.3）：非抛出语义 —— 未安装时 installed=false + 原始输出，
   * 供「一键安装」引导渲染；已安装时携带版本 / 内核 / 默认发行版 / 默认版本。
   */
  getEnv(): Promise<WslEnvInfo>
  /** `wsl --list --online`：可安装发行版清单（含友好名 — 0.1.3） */
  listOnline(): Promise<OnlineDistro[]>
  /** `wsl --install [-d name]`：流式日志 + 可取消 */
  install(name: string | undefined, ctl: TaskControl): Promise<void>
  /**
   * `wsl --update [--pre-release]`（0.1.3）：流式任务，完成后按「前后版本对比 + 输出文本」
   * 如实报告三种结果（版本已变 / 无变化 / 需要重启），绝不伪造「有新版本」。
   */
  update(ctl: TaskControl, opts?: { preRelease?: boolean }): Promise<void>
  /** `wsl --update --rollback`（0.1.3）：回滚最近一次 WSL 更新 */
  updateRollback(ctl: TaskControl): Promise<void>
  /** `wsl --set-default-version <1|2>`（0.1.3）：仅影响新导入的发行版 */
  setDefaultVersion(version: 1 | 2): Promise<void>
  /** `wsl --manage <name> --set-sparse <true|false>`（0.1.3，WSL 2.0+） */
  setSparse(name: string, sparse: boolean, ctl: TaskControl): Promise<void>
  /** `wsl --unregister`：危险操作，调用方负责确认 */
  unregister(name: string): Promise<void>
  /** `wsl --set-version`：长任务（1↔2 转换） */
  setVersion(name: string, version: 1 | 2, ctl: TaskControl): Promise<void>
}

function assertName(name: string): string {
  return assertSafeDistroName(name)
}

/**
 * 读取 `wsl --version` 的版本号（失败/解析不到返回 ''）。
 * 更新任务的前后对比用：读取失败绝不抛错阻断任务本身（对比降级为空）。
 */
async function readWslVersionSafe(): Promise<string> {
  try {
    const r = await runWsl(['--version'])
    if (r.code !== 0) return ''
    return (
      /WSL\s+version[:：]\s*([\d.]+)/i.exec(r.stdout)?.[1] ??
      /版本[:：]\s*([\d.]+)/.exec(r.stdout)?.[1] ??
      ''
    )
  } catch {
    return ''
  }
}

async function runOk(
  args: string[],
  errCode:
    'DISTRO_NOT_FOUND' | 'WSL_NOT_FOUND' | 'WSL_NOT_INSTALLED' | 'TASK_FAILED' = 'TASK_FAILED',
  rawCommand?: string,
): Promise<void> {
  const r = await runWsl(args)
  if (r.code !== 0) {
    throw createAppError(errCode, {
      message: r.stderr?.trim() || `命令执行失败（exit ${r.code}）`,
      detail: r.stderr || r.stdout,
      rawCommand: rawCommand ?? `wsl.exe ${args.join(' ')}`,
    })
  }
}

export interface WslServiceOptions {
  /** 提权助手（M7）：install / setVersion 权限不足时改由独立提权进程执行（§14.3） */
  elevation?: { runOne(req: ElevationRequest): Promise<ElevationOpResult> }
}

export function createWslService(logger: Logger, opts: WslServiceOptions = {}): WslService {
  /**
   * 流式执行 + 权限不足时提权降级（M7）。
   * `wsl --install` / `--set-version` 需要管理员权限：直接执行被拒时改由提权助手执行。
   */
  async function spawnOrElevate(
    args: string[],
    op: 'wsl.install' | 'wsl.setVersion' | 'wsl.update' | 'wsl.updateRollback' | 'wsl.setSparse',
    params: Record<string, string | number | boolean>,
    ctl: TaskControl,
  ): Promise<void> {
    try {
      await spawnWslTask(args, ctl, logger)
    } catch (e) {
      const detail =
        e && typeof e === 'object' && 'detail' in e
          ? String((e as { detail?: string }).detail ?? '')
          : ''
      if (isElevationError(detail) && opts.elevation) {
        ctl.log(`权限不足，改由提权助手执行：${ELEVATION_OP_LABEL[op]}…`)
        logger.info('wsl requires elevation, delegating', { op })
        const res = await opts.elevation.runOne({ op, params })
        if (res.ok) {
          ctl.log('提权执行成功')
          return
        }
        throw createAppError('PERMISSION_DENIED', {
          message: `${ELEVATION_OP_LABEL[op]}失败：提权执行失败`,
          detail: `${res.stderr}\n${res.stdout}`.trim(),
          rawCommand: getRawCommand('wsl.exe', args),
          suggestion: ELEVATION_SUGGESTION,
        })
      }
      throw e
    }
  }
  async function list(): Promise<DistroRuntime[]> {
    const r = await runWsl(['--list', '--verbose'])
    if (r.code !== 0) {
      const text = `${r.stderr}\n${r.stdout}`
      // spawn 级错误（wsl.exe 缺失）与未启用 WSL 都要映射到可行动的错误码（review M6）
      if (/ENOENT|not recognized|找不到|not found|spawn/i.test(text)) {
        throw createAppError('WSL_NOT_FOUND', {
          detail: text.trim(),
          suggestion: '请确认已安装 WSL 且 wsl.exe 在 PATH 中（wsl --install）',
        })
      }
      if (/not installed|未安装|not enabled/i.test(text)) {
        throw createAppError('WSL_NOT_INSTALLED', { detail: text.trim() })
      }
      throw createAppError('TASK_FAILED', {
        message: '读取发行版列表失败',
        detail: text.trim(),
        rawCommand: 'wsl.exe --list --verbose',
      })
    }

    const parsed = parseDistroList(r.stdout)
    return parsed.map((p) => ({
      name: p.name,
      state: normalizeState(p.state),
      version: (p.version === 1 ? 1 : 2) as 1 | 2,
      isDefault: p.isDefault,
    }))
  }

  return {
    list,

    async listWithMeta(metaByName) {
      const runtime = await list()
      // 大小写归一索引：WSL 发行版名不区分大小写，meta 命中必须同语义，
      // 否则 WSL 回报大小写与 distros.jsonc 不一致时别名/置顶等元数据静默丢失（review 根治）
      const byLower = new Map([...metaByName].map(([k, v]) => [k.toLowerCase(), v]))
      return runtime.map((rt) => {
        const meta = byLower.get(rt.name.toLowerCase())
        return {
          ...rt,
          meta: meta ?? {
            name: rt.name,
            alias: '',
            tags: [],
            color: DISTRO_BRAND_COLORS[rt.name] ?? '',
            icon: rt.name.toLowerCase().split('-')[0] ?? 'linux',
            note: '',
            startupCwd: '~',
            pinned: false,
            quickActions: [],
          },
        }
      })
    },

    async assertRunning(name: string) {
      const n = assertName(name)
      const items = await list()
      const hit = items.find((d) => d.name.toLowerCase() === n.toLowerCase())
      if (!hit) {
        throw createAppError('DISTRO_NOT_FOUND', {
          message: `找不到发行版 ${n}`,
          suggestion: '请刷新发行版列表后重试',
        })
      }
      if (hit.state !== 'Running') {
        throw createAppError('DISTRO_NOT_RUNNING', {
          message: `发行版 ${hit.name} 未运行`,
          suggestion: '请先在「发行版」列表点「启动」——WSLPilot 不会隐式启动发行版',
        })
      }
    },

    async start(name) {
      const n = assertName(name)
      // 启动 = 以默认 shell 跑一条空命令，让发行版进入 Running
      await runOk(['-d', n, '-e', 'true'], 'DISTRO_NOT_FOUND')
    },

    async terminate(name) {
      const n = assertName(name)
      await runOk(['--terminate', n], 'DISTRO_NOT_FOUND')
    },

    async shutdown() {
      await runOk(['--shutdown'], 'TASK_FAILED')
    },

    async setDefault(name) {
      const n = assertName(name)
      await runOk(['--set-default', n], 'DISTRO_NOT_FOUND')
    },

    async getVersion() {
      const ver = await runWsl(['--version'])
      const status = await runWsl(['--status'])
      // 两条命令都失败（wsl.exe 缺失 / 未安装 / 未更新）时绝不能装作成功返回空串
      if (ver.code !== 0 && status.code !== 0) {
        throw createAppError('TASK_FAILED', {
          message: '无法获取 WSL 版本',
          detail: [ver.stderr, ver.stdout, status.stderr, status.stdout]
            .map((t) => (t ?? '').trim())
            .filter(Boolean)
            .join('\n'),
          rawCommand: 'wsl.exe --version',
          suggestion: '请安装 WSL 或运行 wsl --update',
        })
      }
      const text = `${ver.stdout}\n${status.stdout}`
      const wslVersion =
        /WSL\s+version[:：]\s*([\d.]+)/i.exec(text)?.[1] ??
        /版本[:：]\s*([\d.]+)/.exec(text)?.[1] ??
        ''
      const kernelVersion =
        /Kernel\s+version[:：]\s*([^\r\n]+)/i.exec(text)?.[1] ??
        /内核版本[:：]\s*([^\r\n]+)/.exec(text)?.[1] ??
        ''
      // 一成功一失败、或命令成功但解析不到版本号：如实返回 raw/空串并告警（旧版 wsl 可能不支持 --version）
      if (ver.code !== 0 || status.code !== 0 || !wslVersion) {
        logger.warn('wsl version degraded', {
          verCode: ver.code,
          statusCode: status.code,
          wslVersion,
        })
      }
      return { raw: text.trim(), wslVersion, kernelVersion }
    },

    /**
     * 环境体检（0.1.3）：非抛出语义。
     * 未安装 → installed:false + 原始输出（供引导一键安装）；
     * 已安装 → 版本 / 内核 / 默认发行版 / 默认版本（`wsl --status` 全量解析，绝不伪造）。
     */
    async getEnv(): Promise<WslEnvInfo> {
      const ver = await runWsl(['--version'])
      const status = await runWsl(['--status'])
      const rawOf = (): string =>
        [ver.stderr, ver.stdout, status.stderr, status.stdout]
          .map((t) => (t ?? '').trim())
          .filter(Boolean)
          .join('\n')
      if (ver.code !== 0 && status.code !== 0) {
        logger.warn('wsl env: not available', {
          verCode: ver.code,
          statusCode: status.code,
        })
        return {
          installed: false,
          wslVersion: '',
          kernelVersion: '',
          defaultDistro: '',
          defaultVersion: null,
          statusRaw: rawOf(),
        }
      }
      const text = `${ver.stdout}\n${status.stdout}`
      const wslVersion =
        /WSL\s+version[:：]\s*([\d.]+)/i.exec(text)?.[1] ??
        /版本[:：]\s*([\d.]+)/.exec(text)?.[1] ??
        ''
      const parsed = parseWslStatus(status.stdout)
      // 内核版本：优先 --status；旧版 wsl 的 --status 可能不含，回退到组合文本（--version 通常携带）
      const kernelFallback =
        /Kernel\s+version[:：]\s*([^\r\n]+)/i.exec(text)?.[1]?.trim() ??
        /内核版本[:：]\s*([^\r\n]+)/.exec(text)?.[1]?.trim() ??
        ''
      return {
        installed: true,
        wslVersion,
        kernelVersion: parsed.kernelVersion || kernelFallback,
        defaultDistro: parsed.defaultDistro,
        defaultVersion: parsed.defaultVersion,
        statusRaw: text.trim(),
      }
    },

    /**
     * 采样单个发行版资源指标。
     * free / df / /proc/stat 两次差分（真实 CPU%）；
     * 采样失败（命令非零退出，或输出解析后 mem/disk 总量都不可信）时抛 TASK_FAILED，
     * 由 sampleOverview 按失败样本处理——不进 CPU 分母、不进 perDistro，绝不返回零值假成功。
     */
    async sampleMetrics(name: string): Promise<Metrics> {
      const n = assertName(name)
      // 标签前缀解析，杜绝"mem 行/磁盘行格式相同靠顺序区分"的耦合（review M17）
      const script = [
        `free -k 2>/dev/null | awk '/Mem:/{print "MEM:"$2,$3}'`,
        `df -k / 2>/dev/null | awk 'NR==2{print "DISK:"$3,$2}'`,
        'head -n1 /proc/stat 2>/dev/null',
        'sleep 0.25',
        'head -n1 /proc/stat 2>/dev/null',
      ].join('; ')
      const args = ['-d', n, '-e', 'sh', '-c', script]
      const r = await runWsl(args, { timeoutMs: 8000 })
      const now = new Date().toISOString()

      if (r.code !== 0) {
        logger.debug('metrics sample failed', { name: n, code: r.code })
        throw createAppError('TASK_FAILED', {
          message: `采样 ${n} 资源指标失败（exit ${r.code}）`,
          detail: [r.stderr, r.stdout]
            .map((t) => (t ?? '').trim())
            .filter(Boolean)
            .join('\n')
            .slice(0, 500),
          rawCommand: getRawCommand('wsl.exe', args),
        })
      }

      const lines = r.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      let memTotalKB = 0
      let memUsedKB = 0
      let diskUsedKB = 0
      let diskTotalKB = 0
      const cpuSamples: number[][] = []

      for (const line of lines) {
        if (line.startsWith('MEM:')) {
          const [t, u] = line.slice(4).trim().split(/\s+/)
          memTotalKB = Number(t) || 0
          memUsedKB = Number(u) || 0
        } else if (line.startsWith('DISK:')) {
          const [u, t] = line.slice(5).trim().split(/\s+/)
          diskUsedKB = Number(u) || 0
          diskTotalKB = Number(t) || 0
        } else if (/^cpu\s/.test(line)) {
          const nums = line
            .split(/\s+/)
            .slice(1)
            .map(Number)
            .filter((x) => Number.isFinite(x))
          if (nums.length) cpuSamples.push(nums)
        }
      }

      // 命令成功但没有可信数据（free/df 缺失、输出被截断…）：不能静默返回零值污染统计
      if (memTotalKB <= 0 && diskTotalKB <= 0) {
        logger.debug('metrics sample unparsable', { name: n })
        throw createAppError('TASK_FAILED', {
          message: `采样 ${n} 资源指标失败：输出中无可信数据`,
          detail: [r.stderr, r.stdout]
            .map((t) => (t ?? '').trim())
            .filter(Boolean)
            .join('\n')
            .slice(0, 500),
          rawCommand: getRawCommand('wsl.exe', args),
        })
      }

      // /proc/stat 两次差分 = 真实 CPU 占用率（不再用 loadavg 伪造 — review M18）
      let cpuPercent = 0
      if (cpuSamples.length >= 2) {
        const a = cpuSamples[0]!
        const b = cpuSamples[1]!
        const sum = (arr: number[]) => arr.reduce((s, x) => s + x, 0)
        const idleOf = (arr: number[]) => (arr[3] ?? 0) + (arr[4] ?? 0)
        const dTotal = sum(b) - sum(a)
        const dIdle = idleOf(b) - idleOf(a)
        if (dTotal > 0) {
          cpuPercent = Math.min(100, Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10)
        }
      }

      return {
        memUsedKB,
        memTotalKB,
        diskUsedKB,
        diskTotalKB,
        cpuPercent,
        sampledAt: now,
      }
    },

    async listOnline(): Promise<OnlineDistro[]> {
      const r = await runWsl(['--list', '--online'], { timeoutMs: 60_000 })
      if (r.code !== 0) {
        throw createAppError('TASK_FAILED', {
          message: '获取可安装发行版列表失败',
          detail: r.stderr || r.stdout,
          rawCommand: 'wsl.exe --list --online',
        })
      }
      const lines = r.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '')
      // 定位 NAME/名称 表头，跳过其上的说明行（"The following is a list of ..."）
      // —— 说明行会被误当发行版名（核验修复）
      let start = lines.findIndex((l) => /^(NAME|名称)/i.test(l))
      if (start < 0) start = 0
      else start += 1
      return lines
        .slice(start)
        .filter((l) => !/^-+$/.test(l))
        .map((l) => {
          const parts = l.split(/\s{2,}/)
          const name = parts[0]?.trim() ?? ''
          // FRIENDLY NAME 列（0.1.3）：解析不到时回退 name（绝不空标签）
          const friendlyName = parts.slice(1).join(' ').trim() || name
          return { name, friendlyName }
        })
        .filter((d) => d.name !== '')
    },

    async install(name: string | undefined, ctl: TaskControl): Promise<void> {
      const target = name ? assertName(name) : ''
      const params: Record<string, string | number> = target ? { name: target } : {}
      // 进度诚实（review 假 0% 根治）：起手报 null（不确定态），wsl 输出带百分比时如实上报；
      // 绝不挂一个恒 0% 的假进度
      ctl.report(null, target ? `正在安装 ${target}` : '正在安装 WSL')
      const reportFromOutput = (line: string) => {
        const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(line)
        if (!m) return
        const pct = Number(m[1])
        if (Number.isFinite(pct) && pct >= 0 && pct <= 100) ctl.report(pct, line.trim())
      }
      /** 「需要重启 Windows」提示（0.1.3）：安装程序启用系统功能后常见，如实透传 */
      let needRestart = false
      const hooked: TaskControl = {
        ...ctl,
        log: (l: string) => {
          if (RESTART_REQUIRED_RE.test(l)) needRestart = true
          ctl.log(l)
          reportFromOutput(l)
        },
      }

      /**
       * 完成判定（review「永远进行中」+「前缀误判」双根治）：
       * `wsl --install` 装完会拉起发行版**首启会话并挂住不退出** → 任务永远跑着。
       * 三层收敛：① `--no-launch` 装完即退（常规路径）；② 老 WSL 不识别该开关 → 去掉重试；
       * ③ 进程仍挂时以「目标发行版已注册」（wsl --list 可观测）为完成信号结算任务。
       * 注册信号只在**安装前不存在**时启用：装前已存在时目标会立刻命中，
       * 不得据此假结算（否则真安装还没开始就被判完成）。
       */
      const isTargetRegistered = async (): Promise<boolean> => {
        if (!target) return false
        try {
          const r = await runWsl(['--list'])
          return r.code === 0 && listContainsDistro(r.stdout, target)
        } catch {
          return false
        }
      }
      const runWithCompletion = async (args: string[]): Promise<void> => {
        let finished = false
        let err: unknown = null
        const p = spawnOrElevate(args, 'wsl.install', params, hooked).then(
          () => {
            finished = true
          },
          (e) => {
            finished = true
            err = e
          },
        )
        // 安装前基线：记录目标是否已注册（决定注册信号是否启用）
        const preExisting = target ? await isTargetRegistered() : false
        if (target && !preExisting) {
          while (!finished) {
            // 与进程退出竞速：退出即刻返回（不空等一个轮询周期）
            await Promise.race([p, new Promise((r) => setTimeout(r, 4000))])
            if (finished) break
            if (await isTargetRegistered()) {
              ctl.log(`检测到 ${target} 已注册，安装完成（尾随的首启会话不再等待）`)
              void p.catch(() => {})
              return
            }
          }
        }
        await p
        if (err) throw err
      }

      const argsNoLaunch = ['--install', ...(target ? ['-d', target] : []), '--no-launch']
      const argsPlain = ['--install', ...(target ? ['-d', target] : [])]
      try {
        await runWithCompletion(argsNoLaunch)
      } catch (e) {
        const detail = `${e instanceof Error ? e.message : String(e)} ${(e as { detail?: string })?.detail ?? ''}`
        if (
          !/no-launch|unknown option|invalid command line|无效.*选项|未识别.*选项/i.test(detail)
        ) {
          throw e
        }
        ctl.log('当前 WSL 不识别 --no-launch，改用标准安装（完成以注册为准）…')
        await runWithCompletion(argsPlain)
      }
      if (needRestart) {
        ctl.log('安装程序提示需要重启 Windows —— 请重启后再使用 WSL')
        ctl.report(100, '安装完成 · 需要重启 Windows 后生效')
      } else {
        ctl.report(100, '安装完成')
      }
    },

    /**
     * `wsl --update [--pre-release]`（0.1.3）。
     * 无网络版本源可查，不做「检查到新版本」的伪判定：只按
     * 「更新命令成功 + 前后版本对比 + 输出文本」如实报告三种结果。
     */
    async update(ctl: TaskControl, opts: { preRelease?: boolean } = {}): Promise<void> {
      const preRelease = opts.preRelease === true
      const args = buildUpdateArgs(preRelease)
      const before = await readWslVersionSafe()
      let needRestart = false
      const hooked: TaskControl = {
        ...ctl,
        log: (l: string) => {
          if (RESTART_REQUIRED_RE.test(l)) needRestart = true
          ctl.log(l)
        },
      }
      ctl.report(null, preRelease ? '正在通过预发布通道更新 WSL' : '正在更新 WSL')
      await spawnOrElevate(args, 'wsl.update', { preRelease }, hooked)
      const after = await readWslVersionSafe()
      if (before && after && before !== after) {
        ctl.log(`版本变化：${before} → ${after}`)
        ctl.report(
          100,
          needRestart
            ? `WSL 已更新：${before} → ${after} · 需要重启 Windows 后生效`
            : `WSL 已更新：${before} → ${after}`,
        )
      } else if (after) {
        ctl.report(
          100,
          needRestart
            ? `WSL 更新完成（当前版本 ${after}）· 需要重启 Windows 后生效`
            : `WSL 更新检查完成（当前版本 ${after}）`,
        )
      } else {
        ctl.report(100, needRestart ? 'WSL 更新完成 · 需要重启 Windows 后生效' : 'WSL 更新完成')
      }
      if (needRestart) {
        ctl.log('安装程序提示需要重启 Windows —— 请重启后再使用 WSL')
      }
    },

    /** `wsl --update --rollback`（0.1.3）：回滚最近一次 WSL 更新 */
    async updateRollback(ctl: TaskControl): Promise<void> {
      ctl.report(null, '正在回滚 WSL 更新')
      await spawnOrElevate(buildUpdateRollbackArgs(), 'wsl.updateRollback', {}, ctl)
      ctl.report(100, 'WSL 更新回滚完成')
    },

    /** `wsl --set-default-version <1|2>`（0.1.3）：仅影响新导入的发行版 */
    async setDefaultVersion(version: 1 | 2): Promise<void> {
      const args = buildSetDefaultVersionArgs(version)
      const r = await runWsl(args)
      if (r.code === 0) return
      const text = `${r.stderr}\n${r.stdout}`
      if (isElevationError(text) && opts.elevation) {
        logger.info('wsl --set-default-version requires elevation, delegating')
        const res = await opts.elevation.runOne({
          op: 'wsl.setDefaultVersion',
          params: { version },
        })
        if (res.ok) return
        throw createAppError('PERMISSION_DENIED', {
          message: `设置默认 WSL 版本失败：提权执行失败`,
          detail: `${res.stderr}\n${res.stdout}`.trim(),
          rawCommand: getRawCommand('wsl.exe', args),
          suggestion: ELEVATION_SUGGESTION,
        })
      }
      throw createAppError('TASK_FAILED', {
        message: `设置默认 WSL 版本失败（exit ${r.code}）`,
        detail: text.trim(),
        rawCommand: getRawCommand('wsl.exe', args),
      })
    },

    /** `wsl --manage <name> --set-sparse <true|false>`（0.1.3，WSL 2.0+） */
    async setSparse(name: string, sparse: boolean, ctl: TaskControl): Promise<void> {
      const safe = assertName(name)
      const args = buildSetSparseArgs(safe, sparse)
      ctl.report(null, sparse ? `正在启用 ${safe} 的稀疏磁盘` : `正在关闭 ${safe} 的稀疏磁盘`)
      try {
        await spawnOrElevate(args, 'wsl.setSparse', { name: safe, sparse }, ctl)
      } catch (e) {
        const detail =
          e && typeof e === 'object' && 'detail' in e
            ? String((e as { detail?: string }).detail ?? '')
            : ''
        if (
          /set-sparse|--manage/i.test(detail) &&
          /unknown|invalid|not recognized|无法识别|无效/i.test(detail)
        ) {
          throw createAppError('TASK_FAILED', {
            message: '当前 WSL 不支持稀疏磁盘操作',
            detail,
            rawCommand: getRawCommand('wsl.exe', args),
            suggestion: '请先在「设置 → WSL」把 WSL 更新到 2.0 及以上后重试',
          })
        }
        throw e
      }
      ctl.report(100, sparse ? `已启用稀疏磁盘：${safe}` : `已关闭稀疏磁盘：${safe}`)
    },

    async unregister(name: string): Promise<void> {
      await runOk(['--unregister', assertName(name)], 'DISTRO_NOT_FOUND')
    },

    async setVersion(name: string, version: 1 | 2, ctl: TaskControl): Promise<void> {
      const safeName = assertName(name)
      const args = ['--set-version', safeName, version === 1 ? '1' : '2']
      ctl.report(0, `正在转换为 WSL${version}`)
      await spawnOrElevate(args, 'wsl.setVersion', { name: safeName, version }, ctl)
      ctl.report(100, `已转换为 WSL${version}`)
    },
  }
}
