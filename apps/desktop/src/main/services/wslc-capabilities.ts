/**
 * wslc 能力探测（0.2.0）— 唯一事实源。
 *
 * 与 wsl 能力探测分离：wslc 是独立可执行文件，缺失/旧版不影响发行版管理。
 * 探测失败一律 fail-soft（installed:false），由容器页显示「更新 WSL」而不是白屏。
 */
import type { WslcCapabilities } from '@wslpilot/shared'
import { runTool, type Logger, type RunToolFn } from '@wslpilot/kit'

const EMPTY: WslcCapabilities = {
  installed: false,
  version: '',
  jsonLists: false,
  jsonStats: false,
  events: false,
  health: false,
  copy: false,
  restart: false,
  systemInfo: false,
  session: false,
  mount: false,
  gpu: false,
  networks: false,
  volumes: false,
  settingsFile: false,
}

export function wslcVersionAtLeast(current: string, min: string): boolean {
  const a = String(current ?? '')
    .split('.')
    .map((x) => Number(x))
  const b = String(min ?? '')
    .split('.')
    .map((x) => Number(x))
  if (!a.length || a.some((x) => !Number.isFinite(x))) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return true
}

export function parseWslcVersion(text: string): string {
  const json = /"version"\s*:\s*"([^"]+)"/i.exec(text)?.[1]
  if (json) return json
  return /(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] ?? ''
}

/** 从 help 文本探测子命令/flag；wslc 版本差异只影响可选功能 */
export function parseWslcHelpCapabilities(
  helpText: string,
  version: string,
): Omit<WslcCapabilities, 'installed' | 'version'> {
  const t = String(helpText ?? '')
  const has = (re: RegExp) => re.test(t)
  return {
    jsonLists: has(/--format\b/) && has(/\bjson\b/i),
    jsonStats: has(/--format\b/) && has(/\bstats\b/i),
    events: has(/\bevents\b/i),
    health: has(/--health-cmd|healthcheck/i),
    copy: has(/\bcp\b|container\s+cp/i),
    restart: has(/container\s+restart|\brestart\b/i),
    systemInfo: has(/system\s+info/i),
    session: has(/system\s+session/i),
    mount: has(/--mount\b/i),
    gpu: has(/--gpus\b/i),
    networks: has(/\bnetwork(s)?\b/i),
    volumes: has(/\bvolume(s)?\b/i),
    settingsFile: wslcVersionAtLeast(version, '2.9.3'),
  }
}

export interface WslcProbeDeps {
  logger?: Logger
  runTool?: RunToolFn
}

/**
 * 顶层 `wslc --help` 只列命令，不包含 run/list 的 flag。
 * 0.2.0 实测（3.0.3.0）：只读顶层帮助会把 jsonLists/systemInfo/session/health/copy
 * 全部误判为 false，容器页退化到表格且统计永远为空。这里并行读取子命令帮助，
 * 合并后再走同一解析器（唯一判定入口）。
 */
const HELP_COMMANDS: string[][] = [
  ['--help'],
  ['run', '--help'],
  ['container', '--help'],
  ['container', 'cp', '--help'],
  ['container', 'list', '--help'],
  ['image', 'list', '--help'],
  ['network', 'list', '--help'],
  ['volume', 'list', '--help'],
  ['stats', '--help'],
  ['system', 'info', '--help'],
  ['system', 'session', 'list', '--help'],
]

export async function probeWslcCapabilities(deps: WslcProbeDeps = {}): Promise<WslcCapabilities> {
  const tool = deps.runTool ?? runTool
  try {
    const versionRes = await tool('wslc.exe', ['version', '--format', 'json'], {
      timeoutMs: 10_000,
    })
    const versionText = `${versionRes.stdout}\n${versionRes.stderr}`
    const version = parseWslcVersion(versionText)
    if (versionRes.code !== 0 && !version) {
      deps.logger?.debug('wslc version failed', { detail: versionText.slice(0, 200) })
      return { ...EMPTY }
    }
    const helps = await Promise.all(
      HELP_COMMANDS.map((args) =>
        tool('wslc.exe', args, { timeoutMs: 10_000 }).catch(() => ({
          stdout: '',
          stderr: '',
          code: -1,
        })),
      ),
    )
    const helpText = helps.map((r) => `${r.stdout}\n${r.stderr}`).join('\n')
    return {
      ...EMPTY,
      ...parseWslcHelpCapabilities(helpText, version),
      installed: true,
      version,
    }
  } catch (e) {
    deps.logger?.warn('wslc probe failed', { error: String(e) })
    return { ...EMPTY }
  }
}
