/**
 * 网络（M6）纯助手 — 端口转发 / 镜像网络模式 / 代理。
 * 等价命令行与真实执行同源构建（设计书 §9.6），主/渲染共享，杜绝各写一份。
 */
import { formatCommand } from './commands'
import { createAppError } from './errors'
import type { NetworkMode, PortForwardRule, PortProxyEntry, ProxyConfig } from './types'

/** netsh portproxy 隧道类型：仅支持 TCP v4→v4（udp 规则只在配置里记录意图） */
export const PORTPROXY_KIND = 'v4tov4' as const

/** 发行版内代理脚本路径（应用/清除代理的唯一落点） */
export const PROXY_SCRIPT_PATH = '/etc/profile.d/wslpilot-proxy.sh'

/** 转发规则条数上限（network.jsonc 写入约束） */
export const MAX_PORT_FORWARD_RULES = 100

const RULE_ID_BAD_CHARS = /[\\/:*?"<>|]/
// eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * 转发规则 id 安全校验（执行白名单的键）：非空、≤100、无控制字符与文件名非法字符。
 * 与 `assertSafeActionId` 同一规则族：IPC 边界与执行边界必须一致。
 */
export function assertSafeRuleId(id: unknown): string {
  const s = typeof id === 'string' ? id.trim() : ''
  const bad = (msg: string): never => {
    throw createAppError('CONFIG_INVALID', {
      message: msg,
      suggestion: '规则 id 不得包含 \\ / : * ? " < > | 或控制字符，长度 1–100',
    })
  }
  if (!s || s.length > 100) bad('规则 id 非法（空或超过 100 字符）')
  if (CONTROL_CHARS.test(s)) bad('规则 id 非法（含控制字符）')
  if (RULE_ID_BAD_CHARS.test(s)) bad('规则 id 非法（含非法字符）')
  return s
}

export interface PortProxyTarget {
  listenAddress: string
  listenPort: number
  connectAddress: string
  connectPort: number
}

/** `netsh interface portproxy add v4tov4 …` 参数数组（不拼接用户输入进 shell） */
export function buildPortProxyAddArgs(t: PortProxyTarget): string[] {
  return [
    'interface',
    'portproxy',
    'add',
    PORTPROXY_KIND,
    `listenaddress=${t.listenAddress}`,
    `listenport=${t.listenPort}`,
    `connectaddress=${t.connectAddress}`,
    `connectport=${t.connectPort}`,
  ]
}

/** `netsh interface portproxy delete v4tov4 …` 参数数组 */
export function buildPortProxyDeleteArgs(
  t: Pick<PortProxyTarget, 'listenAddress' | 'listenPort'>,
): string[] {
  return [
    'interface',
    'portproxy',
    'delete',
    PORTPROXY_KIND,
    `listenaddress=${t.listenAddress}`,
    `listenport=${t.listenPort}`,
  ]
}

/** `netsh interface portproxy show all` 参数数组 */
export function buildPortProxyShowArgs(): string[] {
  return ['interface', 'portproxy', 'show', 'all']
}

/** 等价命令行（仅界面展示 / 任务日志，绝不用于执行） */
export function previewNetshCommand(
  rule: PortForwardRule | PortProxyTarget,
  op: 'add' | 'delete',
): string {
  return formatCommand(
    'netsh.exe',
    op === 'add' ? buildPortProxyAddArgs(rule) : buildPortProxyDeleteArgs(rule),
  )
}

/**
 * 解析 `netsh interface portproxy show all` 输出。
 * 只认「地址 端口 地址 端口」四列数据行，表头随系统语言变化一律跳过（宽容解析）。
 */
export function parsePortProxyShow(raw: string): PortProxyEntry[] {
  const out: PortProxyEntry[] = []
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const m = /^(\S+)\s+(\d{1,5})\s+(\S+)\s+(\d{1,5})\s*$/.exec(line.trim())
    if (!m) continue
    const listenPort = Number(m[2])
    const connectPort = Number(m[4])
    if (!isValidPort(listenPort) || !isValidPort(connectPort)) continue
    out.push({
      listenAddress: m[1]!,
      listenPort,
      connectAddress: m[3]!,
      connectPort,
      kind: PORTPROXY_KIND,
    })
  }
  return out
}

/** 系统转发条目 ↔ 规则是否匹配（监听地址+端口即唯一键） */
export function ruleMatchesEntry(rule: PortForwardRule, e: PortProxyEntry): boolean {
  return (
    rule.listenAddress === e.listenAddress &&
    rule.listenPort === e.listenPort &&
    rule.connectAddress === e.connectAddress &&
    rule.connectPort === e.connectPort
  )
}

/** 规则在系统表中是否有对应条目（仅监听键） */
export function entryListened(
  entries: readonly PortProxyEntry[],
  listenAddress: string,
  listenPort: number,
): PortProxyEntry | null {
  return (
    entries.find((e) => e.listenAddress === listenAddress && e.listenPort === listenPort) ?? null
  )
}

// ─────────────────────── 镜像网络模式（.wslconfig） ───────────────────────

/** networkingMode 原值 → 规范化枚举 */
export function normalizeNetworkMode(value: string): NetworkMode {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
  if (s === 'mirrored') return 'mirrored'
  if (s === 'nat') return 'nat'
  if (s === 'bridged') return 'bridged'
  if (s === 'virtioproxy') return 'virtioproxy'
  return 'unknown'
}

/**
 * 解析 `%UserProfile%\.wslconfig` 的 `[wsl2] networkingMode`。
 * 注释（# / ;）与非 `[wsl2]` 段落忽略；未配置返回 `unknown`（WSL 默认 NAT）。
 */
export function parseWslConfigMode(content: string): { mode: NetworkMode; raw: string } {
  let inWsl2 = false
  for (const rawLine of String(content ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/[#;].*$/, '').trim()
    if (!line) continue
    const sec = /^\[([^\]]+)\]$/.exec(line)
    if (sec) {
      inWsl2 = sec[1]!.trim().toLowerCase() === 'wsl2'
      continue
    }
    if (!inWsl2) continue
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line)
    if (kv && kv[1]!.toLowerCase() === 'networkingmode') {
      const raw = kv[2]!.trim().replace(/^["']|["']$/g, '')
      return { mode: normalizeNetworkMode(raw), raw }
    }
  }
  return { mode: 'unknown', raw: '' }
}

/** 镜像模式配置片段（引导卡展示 + 一键复制） */
export function mirrorModeSnippet(): string {
  return ['[wsl2]', 'networkingMode=mirrored'].join('\n')
}

/** 网络模式展示名（界面文案唯一事实源） */
export const NETWORK_MODE_LABEL: Record<NetworkMode, string> = {
  mirrored: '镜像 mirrored',
  nat: 'NAT',
  bridged: '桥接 bridged',
  virtioproxy: 'virtio 代理',
  unknown: '未配置（默认 NAT）',
}

/** 镜像模式引导文案（mode 非 mirrored 时展示） */
export function mirrorModeGuidance(mode: NetworkMode): {
  title: string
  body: string
  snippet: string
} {
  const label = NETWORK_MODE_LABEL[normalizeNetworkMode(mode)] ?? '未配置（默认 NAT）'
  return {
    title: '推荐开启镜像网络模式（mirrored）',
    body:
      `当前网络模式：${label}。开启镜像模式后，Windows 与 WSL 共用网络栈：` +
      '宿主机可直接访问 Linux 服务的 localhost，无需端口转发，IPv6 与 VPN 也更可靠。',
    snippet: mirrorModeSnippet(),
  }
}

// ─────────────────────── 代理 ───────────────────────

/** `127.0.0.1:7890` → `http://127.0.0.1:7890`（已是 URL 则原样） */
export function normalizeProxyUrl(value: string): string {
  const t = String(value ?? '').trim()
  if (!t) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`
}

export interface EffectiveProxy {
  http: string
  https: string
  noProxy: string
}

/**
 * 解析生效代理：`useWindowsProxy` 时以 Windows 系统代理为回退，
 * 本地显式填写的值优先（用户意图永远压过系统默认）。
 */
export function resolveEffectiveProxy(
  proxy: ProxyConfig,
  windows?: { enabled: boolean; server: string } | null,
): EffectiveProxy {
  const http = String(proxy.httpProxy ?? '').trim()
  const https = String(proxy.httpsProxy ?? '').trim()
  const noProxy = String(proxy.noProxy ?? '').trim()
  if (proxy.useWindowsProxy && windows?.enabled) {
    const base = normalizeProxyUrl(windows.server)
    return {
      http: normalizeProxyUrl(http || base),
      https: normalizeProxyUrl(https || base),
      noProxy,
    }
  }
  return {
    http: normalizeProxyUrl(http),
    https: normalizeProxyUrl(https),
    noProxy,
  }
}

/** 生效代理 → 发行版内 `/etc/profile.d/wslpilot-proxy.sh` 脚本内容 */
export function buildProxyScript(eff: EffectiveProxy): string {
  const lines: string[] = [
    '# Managed by WSLPilot — 代理环境变量',
    '# 可手工编辑或直接删除本文件；重新应用会覆盖此处内容。',
    '',
  ]
  const push = (name: string, value: string) => {
    if (!value) return
    lines.push(`export ${name}=${shellQuote(value)}`)
  }
  push('http_proxy', eff.http)
  push('HTTP_PROXY', eff.http)
  push('https_proxy', eff.https)
  push('HTTPS_PROXY', eff.https)
  push('no_proxy', eff.noProxy)
  push('NO_PROXY', eff.noProxy)
  if (lines.length === 3) {
    lines.push('# 当前未配置任何代理变量（可清除此脚本）')
  }
  return `${lines.join('\n')}\n`
}

/** POSIX shell 单引号包裹（代理值可能含 `:` `/`，不进 shell 拼接语义也要防引号闭合） */
export function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** 代理配置 → 一行摘要（列表/摘要展示） */
export function proxySummary(proxy: ProxyConfig): string {
  const eff = resolveEffectiveProxy(proxy, null)
  const parts: string[] = []
  if (proxy.useWindowsProxy) parts.push('跟随系统')
  if (eff.http) parts.push(`HTTP ${eff.http}`)
  if (eff.https) parts.push(`HTTPS ${eff.https}`)
  return parts.length > 0 ? parts.join(' · ') : '未配置'
}

// ─────────────────────── 表单校验（渲染层与执行边界共用） ───────────────────────

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isValidIpv4(value: string): boolean {
  const m = IPV4_RE.exec(value.trim())
  if (!m) return false
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i])
    if (!Number.isInteger(n) || n < 0 || n > 255) return false
  }
  return true
}

export function isValidIpv6(value: string): boolean {
  const s = value.trim()
  return s.includes(':') && /^[0-9a-fA-F:.%[\]]+$/.test(s)
}

/** 监听/转发地址：IPv4 / IPv6 / 主机名（netsh 需要具体地址，不接受空） */
export function isValidAddress(value: string): boolean {
  const s = String(value ?? '').trim()
  if (!s) return false
  // 纯数字+点的形态必须是合法 IPv4（拒绝 999.1.1.1 之类伪装成主机名）
  if (/^[\d.]+$/.test(s)) return isValidIpv4(s)
  return isValidIpv6(s) || /^[A-Za-z0-9._-]{1,253}$/.test(s)
}

export interface PortForwardFormLike {
  id: string
  distro: string
  listenAddress: string
  listenPort: number | string | null | undefined
  connectAddress: string
  connectPort: number | string | null | undefined
  protocol: 'tcp' | 'udp'
  enabled: boolean
}

/**
 * 转发规则表单校验。返回中文错误文案；通过返回 null。
 * id 唯一性由调用方结合现有规则列表判断（此处只做形状校验）。
 */
export function validatePortForwardRule(
  form: PortForwardFormLike,
  existingIds: readonly string[] = [],
  selfId?: string,
): string | null {
  const id = String(form.id ?? '').trim()
  if (!id) return '规则 id 不能为空'
  try {
    assertSafeRuleId(id)
  } catch (e) {
    return e instanceof Error ? e.message : '规则 id 非法'
  }
  if (existingIds.some((x) => x === id && x !== selfId)) return `规则 id 已存在：${id}`
  const distro = String(form.distro ?? '').trim()
  if (!distro) return '请选择目标发行版'
  if (!isValidAddress(form.listenAddress)) return '监听地址无效（需为 IP 或主机名）'
  if (!isValidAddress(form.connectAddress)) return '转发地址无效（需为 IP 或主机名）'
  const lp = Number(form.listenPort ?? NaN)
  const cp = Number(form.connectPort ?? NaN)
  if (!isValidPort(lp)) return '监听端口需为 1–65535 的整数'
  if (!isValidPort(cp)) return '转发端口需为 1–65535 的整数'
  if (form.protocol !== 'tcp' && form.protocol !== 'udp') return '协议只支持 tcp / udp'
  return null
}

/** 未完成表单的默认值（新建规则） */
export function defaultPortForwardRule(distro = ''): PortForwardRule {
  return {
    id: '',
    distro,
    listenAddress: '0.0.0.0',
    listenPort: 3000,
    connectAddress: '127.0.0.1',
    connectPort: 3000,
    enabled: true,
    protocol: 'tcp',
  }
}

/** 规则是否可应用到系统（netsh 仅支持 TCP） */
export function canApplyRule(rule: PortForwardRule): boolean {
  return rule.protocol === 'tcp'
}

/** 规则摘要文本（确认框 / 任务消息） */
export function ruleSummary(rule: PortForwardRule): string {
  return `${rule.listenAddress}:${rule.listenPort} → ${rule.connectAddress}:${rule.connectPort}（${rule.distro} · ${rule.protocol.toUpperCase()}）`
}
