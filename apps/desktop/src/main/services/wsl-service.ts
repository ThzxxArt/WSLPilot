import type {
  DistroMeta,
  DistroRuntime,
  DistroView,
  Metrics,
  WslState,
} from '@wslpilot/shared'
import {
  createAppError,
  DISTRO_BRAND_COLORS,
} from '@wslpilot/shared'
import { runWsl, parseDistroList, type Logger } from '@wslpilot/kit'

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
}

function assertName(name: string): string {
  const n = (name ?? '').trim()
  if (!n) throw createAppError('DISTRO_NOT_FOUND', { message: '发行版名称不能为空' })
  // 名称仅允许常规字符，防止拼进参数数组外的意外
  if (/[\\/:*?"<>|]/.test(n)) {
    throw createAppError('DISTRO_NOT_FOUND', { message: `非法的发行版名称：${n}` })
  }
  return n
}

async function runOk(
  args: string[],
  errCode: 'DISTRO_NOT_FOUND' | 'WSL_NOT_FOUND' | 'WSL_NOT_INSTALLED' | 'TASK_FAILED' = 'TASK_FAILED',
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
      if (/not recognized|找不到|not found/i.test(text)) {
        throw createAppError('WSL_NOT_FOUND', { detail: text.trim() })
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
     * 在发行版内执行 free / df / loadavg；失败时返回零值而不是抛错（仪表盘降级）。
     */
    async sampleMetrics(name): Promise<Metrics> {
      const n = assertName(name)
      const script =
        'free -k 2>/dev/null | awk \'/Mem:/{print $2,$3}\'; df -k / 2>/dev/null | awk \'NR==2{print $3,$2,$4}\'; cat /proc/loadavg 2>/dev/null | awk \'{print $1}\''
      const r = await runWsl(['-d', n, '-e', 'sh', '-c', script], { timeoutMs: 8000 })
      const now = new Date().toISOString()

      if (r.code !== 0) {
        logger.debug('metrics sample failed', { name: n, code: r.code })
        return {
          memUsedKB: 0,
          memTotalKB: 0,
          diskUsed: '—',
          diskTotal: '—',
          cpuPercent: 0,
          sampledAt: now,
        }
      }

      const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      // 预期：第1行 "memTotal memUsed"（KB），第2行 "used total avail"（KB），第3行 loadavg
      let memTotalKB = 0
      let memUsedKB = 0
      let diskUsedKB = 0
      let diskTotalKB = 0
      let load1 = 0

      for (const line of lines) {
        const mem = /^(\d+)\s+(\d+)$/.exec(line)
        if (mem && !memTotalKB) {
          memTotalKB = Number(mem[1])
          memUsedKB = Number(mem[2])
          continue
        }
        const disk = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(line)
        if (disk && !diskTotalKB) {
          diskUsedKB = Number(disk[1])
          diskTotalKB = Number(disk[2])
          continue
        }
        const load = /^(\d+(?:\.\d+)?)\s/.exec(line + ' ')
        if (load && !load1) load1 = Number(load[1])
      }

      const fmt = (kb: number) => {
        if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)}T`
        if (kb >= 1024) return `${(kb / 1024).toFixed(1)}G`
        return `${kb}K`
      }

      return {
        memUsedKB,
        memTotalKB,
        diskUsed: diskTotalKB ? fmt(diskUsedKB) : '—',
        diskTotal: diskTotalKB ? fmt(diskTotalKB) : '—',
        cpuPercent: Math.min(100, Math.round(load1 * 25 * 10) / 10),
        sampledAt: now,
      }
    },
  }
}
