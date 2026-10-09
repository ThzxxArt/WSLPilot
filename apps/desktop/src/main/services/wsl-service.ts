import type { DistroMeta, DistroRuntime, DistroView, Metrics, WslState } from '@wslpilot/shared'
import { createAppError, assertSafeDistroName, DISTRO_BRAND_COLORS } from '@wslpilot/shared'
import { runWsl, parseDistroList, type Logger } from '@wslpilot/kit'
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

export interface WslStatus {
  raw: string
  wslVersion: string
  kernelVersion: string
}

export interface WslService {
  list(): Promise<DistroRuntime[]>
  listWithMeta(metaByName: Map<string, DistroMeta>): Promise<DistroView[]>
  start(name: string): Promise<void>
  terminate(name: string): Promise<void>
  shutdown(): Promise<void>
  setDefault(name: string): Promise<void>
  getVersion(): Promise<WslStatus>
  sampleMetrics(name: string): Promise<Metrics>
  /** `wsl --list --online`：可安装发行版名列表 */
  listOnline(): Promise<string[]>
  /** `wsl --install [-d name]`：流式日志 + 可取消 */
  install(name: string | undefined, ctl: TaskControl): Promise<void>
  /** `wsl --unregister`：危险操作，调用方负责确认 */
  unregister(name: string): Promise<void>
  /** `wsl --set-version`：长任务（1↔2 转换） */
  setVersion(name: string, version: 1 | 2, ctl: TaskControl): Promise<void>
}

function assertName(name: string): string {
  return assertSafeDistroName(name)
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

export function createWslService(logger: Logger): WslService {
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
      return runtime.map((rt) => {
        const meta = metaByName.get(rt.name)
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
      const text = `${ver.stdout}\n${status.stdout}`
      const wslVersion =
        /WSL\s+version[:：]\s*([\d.]+)/i.exec(text)?.[1] ??
        /版本[:：]\s*([\d.]+)/.exec(text)?.[1] ??
        ''
      const kernelVersion =
        /Kernel\s+version[:：]\s*([^\r\n]+)/i.exec(text)?.[1] ??
        /内核版本[:：]\s*([^\r\n]+)/.exec(text)?.[1] ??
        ''
      return { raw: text.trim(), wslVersion, kernelVersion }
    },

    /**
     * 采样单个发行版资源指标。
     * free / df / /proc/stat 两次差分（真实 CPU%）；
     * 失败时返回零值（展示层显示 —）而不是抛错。
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
      const r = await runWsl(['-d', n, '-e', 'sh', '-c', script], { timeoutMs: 8000 })
      const now = new Date().toISOString()
      const zero: Metrics = {
        memUsedKB: 0,
        memTotalKB: 0,
        diskUsedKB: 0,
        diskTotalKB: 0,
        cpuPercent: 0,
        sampledAt: now,
      }

      if (r.code !== 0) {
        logger.debug('metrics sample failed', { name: n, code: r.code })
        return zero
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

    async listOnline(): Promise<string[]> {
      const r = await runWsl(['--list', '--online'], { timeoutMs: 60_000 })
      if (r.code !== 0) {
        throw createAppError('TASK_FAILED', {
          message: '获取可安装发行版列表失败',
          detail: r.stderr || r.stdout,
          rawCommand: 'wsl.exe --list --online',
        })
      }
      return r.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '' && !/^(NAME|名称)/i.test(l) && !/^-+$/.test(l))
        .map((l) => l.split(/\s{2,}/)[0]?.trim() ?? '')
        .filter((l) => l !== '')
    },

    async install(name: string | undefined, ctl: TaskControl): Promise<void> {
      const args = ['--install', ...(name ? ['-d', assertName(name)] : [])]
      ctl.report(0, name ? `正在安装 ${name}` : '正在安装 WSL')
      await spawnWslTask(args, ctl, logger)
      ctl.report(100, '安装完成')
    },

    async unregister(name: string): Promise<void> {
      await runOk(['--unregister', assertName(name)], 'DISTRO_NOT_FOUND')
    },

    async setVersion(name: string, version: 1 | 2, ctl: TaskControl): Promise<void> {
      const args = ['--set-version', assertName(name), version === 1 ? '1' : '2']
      ctl.report(0, `正在转换为 WSL${version}`)
      await spawnWslTask(args, ctl, logger)
      ctl.report(100, `已转换为 WSL${version}`)
    },
  }
}
