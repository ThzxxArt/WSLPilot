/**
 * WSL 能力探测（0.1.4）— 唯一事实源。
 *
 * 设计取舍：
 * - `wsl --help` 是**主探测**：它反映当前二进制真正接受的 flag，不依赖易漂移的版本表。
 * - 版本表只做兜底：旧版 WSL 的 help 可能不完整/不可用；只对“已知下限”的能力做推断，
 *   不确定的（如 --location / --vhd-size 的精确下限）保持 false，绝不猜“支持”。
 * - 任何探测失败都 fail-soft：返回 source='none' 或部分能力，UI 统一隐藏/禁用。
 */
import { release } from 'node:os'
import { WSL_FEATURE_META, type WslCapabilities, type WslCapabilityFlags } from '@wslpilot/shared'
import { runWsl, runWslc, type Logger } from '@wslpilot/kit'

const FLAG_PATTERNS: Record<keyof WslCapabilityFlags, RegExp> = {
  compact: /--compact\b/,
  resize: /--resize\b/,
  setDefaultUser: /--set-default-user\b/,
  installLocation: /--location\b/,
  vhdSize: /--vhd-size\b/,
  fixedVhd: /--fixed-vhd\b/,
  webDownload: /--web-download\b/,
  exportFormats: /--format\b/,
  importFromFile: /--from-file\b/,
  updatePreRelease: /--pre-release\b/,
  manageSparse: /--set-sparse\b/,
}

const EMPTY_FLAGS: WslCapabilityFlags = {
  compact: false,
  resize: false,
  setDefaultUser: false,
  installLocation: false,
  vhdSize: false,
  fixedVhd: false,
  webDownload: false,
  exportFormats: false,
  importFromFile: false,
  updatePreRelease: false,
  manageSparse: false,
}

/** 从 `wsl --help` 文本逐 flag 探测（导出给单测） */
export function parseWslHelpFlags(helpText: string): WslCapabilityFlags {
  const flags = { ...EMPTY_FLAGS }
  for (const [key, re] of Object.entries(FLAG_PATTERNS) as Array<
    [keyof WslCapabilityFlags, RegExp]
  >) {
    flags[key] = re.test(helpText)
  }
  return flags
}

/** 解析 `WSL 版本: 3.0.3.0` / `WSL version: 2.7.14.0`（导出给单测） */
export function parseWslVersionText(text: string): string {
  return (
    /WSL\s+version[:：]\s*([\d.]+)/i.exec(text)?.[1] ?? /版本[:：]\s*([\d.]+)/.exec(text)?.[1] ?? ''
  )
}

/** 解析 wslc 版本（`wslc 3.0.3.0` 或 JSON 中的 version 字段） */
export function parseWslcVersionText(text: string): string {
  const json = /"version"\s*:\s*"([^"]+)"/i.exec(text)?.[1]
  if (json) return json
  return /(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] ?? ''
}

/** Windows build（`10.0.26300.9711` → 26300） */
export function parseWindowsBuild(version: string): number {
  const parts = String(version ?? '').split('.')
  const n = Number(parts[2] ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** 版本下限比较（只比较数字段；非法版本一律 false） */
export function versionAtLeast(current: string, min: string): boolean {
  const a = current.split('.').map((x) => Number(x))
  const b = min.split('.').map((x) => Number(x))
  if (a.length < 2 || a.some((x) => !Number.isFinite(x))) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return true
}

/**
 * 版本表兜底：只在没有 help 时使用。
 * 直接从 `WSL_FEATURE_META` 的最低版本推导，避免 UI 文案、能力表、版本推断三处漂移。
 * 版本号解析失败/为空时全部保持 false（fail-soft）。
 */
function flagsFromVersion(wslVersion: string): WslCapabilityFlags {
  const flags = { ...EMPTY_FLAGS }
  for (const key of Object.keys(WSL_FEATURE_META) as Array<keyof WslCapabilityFlags>) {
    flags[key] = versionAtLeast(wslVersion, WSL_FEATURE_META[key].minVersion)
  }
  return flags
}

/**
 * 探测当前 WSL 能力。
 * 返回 null 表示 WSL 不可用（未安装/探测完全失败）；调用方必须按“不支持”处理。
 */
export async function probeWslCapabilities(logger?: Logger): Promise<WslCapabilities | null> {
  const [help, version] = await Promise.all([
    runWsl(['--help'], { timeoutMs: 10_000 }),
    runWsl(['--version'], { timeoutMs: 10_000 }),
  ])
  const versionText = `${version.stdout}\n${version.stderr}`
  const wslVersion = version.code === 0 ? parseWslVersionText(versionText) : ''
  // wsl --help 在部分版本写 stderr 且退出码非 0（3.0.3 实测 255）：只要文本里
  // 有真正的选项段落就按 help 解析，不能把“有输出但退出码 255”误判成不可用。
  const helpText = `${help.stdout}\n${help.stderr}`
  const helpUsable = helpText.trim().length > 0 && /--(?:install|manage|export)\b/.test(helpText)
  if (!helpUsable && version.code !== 0) {
    logger?.debug('wsl capability probe failed', {
      helpCode: help.code,
      versionCode: version.code,
    })
    return null
  }

  const helpFlags = helpUsable ? parseWslHelpFlags(helpText) : null
  const versionFlags = wslVersion ? flagsFromVersion(wslVersion) : null
  const flags: WslCapabilityFlags = { ...EMPTY_FLAGS }
  for (const key of Object.keys(FLAG_PATTERNS) as Array<keyof WslCapabilityFlags>) {
    flags[key] = helpFlags ? helpFlags[key] : (versionFlags?.[key] ?? false)
  }

  // wslc 是独立可执行文件：缺失/旧版不影响 wsl 本体能力
  // 结构化 JSON 避免不同语言/版本的文本格式漂移；旧 wslc 不识别时 runWslc 失败即降级。
  const wslc = await runWslc(['version', '--format', 'json'], { timeoutMs: 5_000 }).catch(
    () => null,
  )
  const wslcVersion = wslc && wslc.code === 0 ? parseWslcVersionText(wslc.stdout) : ''

  const source: WslCapabilities['source'] = helpFlags ? 'help' : wslVersion ? 'version' : 'none'
  if (!helpFlags) {
    logger?.debug('wsl --help unavailable, capability flags degraded to version table', {
      wslVersion,
    })
  }

  return {
    source,
    wslVersion,
    windowsBuild: parseWindowsBuild(release()),
    wslcVersion,
    inbox: !wslVersion,
    flags,
  }
}
