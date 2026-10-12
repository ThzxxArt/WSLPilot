/**
 * 端口转发 / 代理表单纯逻辑（M6）。
 * 与 shared/network.ts 的校验与命令预览同源，此处只做「表单 ↔ 领域模型」的编排。
 */
import {
  canApplyRule,
  defaultPortForwardRule,
  previewNetshCommand,
  ruleSummary,
  validatePortForwardRule,
  type NetworkStatus,
  type PortForwardRule,
  type ProxyConfig,
} from '@wslpilot/shared'

export interface PortForwardForm {
  id: string
  distro: string
  listenAddress: string
  listenPort: number | null
  connectAddress: string
  connectPort: number | null
  protocol: 'tcp' | 'udp'
  enabled: boolean
  /** 编辑中的原 id（改名时用于唯一性判断） */
  originalId: string
}

export function defaultPortForwardForm(distro = ''): PortForwardForm {
  const r = defaultPortForwardRule(distro)
  return {
    id: r.id,
    distro: r.distro,
    listenAddress: r.listenAddress,
    listenPort: r.listenPort,
    connectAddress: r.connectAddress,
    connectPort: r.connectPort,
    protocol: r.protocol,
    enabled: r.enabled,
    originalId: '',
  }
}

export function ruleToForm(rule: PortForwardRule): PortForwardForm {
  return {
    id: rule.id,
    distro: rule.distro,
    listenAddress: rule.listenAddress,
    listenPort: rule.listenPort,
    connectAddress: rule.connectAddress,
    connectPort: rule.connectPort,
    protocol: rule.protocol,
    enabled: rule.enabled,
    originalId: rule.id,
  }
}

export function formToRule(form: PortForwardForm): PortForwardRule {
  return {
    id: form.id.trim(),
    distro: form.distro.trim(),
    listenAddress: form.listenAddress.trim(),
    listenPort: Number(form.listenPort ?? 0),
    connectAddress: form.connectAddress.trim(),
    connectPort: Number(form.connectPort ?? 0),
    protocol: form.protocol,
    enabled: form.enabled,
  }
}

/** 表单校验（唯一性结合现有 id 列表；自编辑时豁免原 id） */
export function validatePortForwardForm(
  form: PortForwardForm,
  existing: readonly PortForwardRule[],
): string | null {
  return validatePortForwardRule(
    form,
    existing.map((r) => r.id),
    form.originalId || undefined,
  )
}

/** 新建规则的建议 id（dev-<port>，冲突则加序号） */
export function suggestRuleId(existing: readonly PortForwardRule[], listenPort: number): string {
  const base = `dev-${listenPort}`
  const taken = new Set(existing.map((r) => r.id))
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const id = `${base}-${i}`
    if (!taken.has(id)) return id
  }
  return `${base}-${Date.now()}`
}

export type RuleSystemState = 'applied' | 'mismatch' | 'none' | 'udp-only'

/** `addr:port` 展示（IPv6 用 [] 包裹） */
export function formatRuleRange(address: string, port: number): string {
  const addr = String(address ?? '').trim()
  const host = addr.includes(':') && !addr.startsWith('[') ? `[${addr}]` : addr
  return `${host}:${port}`
}

/** 地址规范化：比较前 trim + 小写（IP/主机名大小写不敏感，空白不应造成误判 — review 0.1.2 根治） */
function normalizeAddr(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

/** 规则与系统转发表的对照状态（表格状态列） */
export function ruleSystemState(
  rule: PortForwardRule,
  status: NetworkStatus | null,
): RuleSystemState {
  if (!canApplyRule(rule)) return 'udp-only'
  const entries = status?.portProxy ?? []
  const ruleListen = normalizeAddr(rule.listenAddress)
  const listened = entries.find(
    (e) => normalizeAddr(e.listenAddress) === ruleListen && e.listenPort === rule.listenPort,
  )
  if (!listened) return 'none'
  const exact = entries.some(
    (e) =>
      normalizeAddr(e.listenAddress) === ruleListen &&
      e.listenPort === rule.listenPort &&
      normalizeAddr(e.connectAddress) === normalizeAddr(rule.connectAddress) &&
      e.connectPort === rule.connectPort,
  )
  return exact ? 'applied' : 'mismatch'
}

const SYSTEM_STATE_LABEL: Record<RuleSystemState, string> = {
  applied: '已生效',
  mismatch: '指向不同',
  none: '未生效',
  'udp-only': '仅记录',
}

export function ruleSystemStateLabel(s: RuleSystemState): string {
  return SYSTEM_STATE_LABEL[s]
}

/** 等价命令行（应用） */
export function ruleApplyCommand(rule: PortForwardRule): string {
  return previewNetshCommand(rule, 'add')
}

/** 等价命令行（从系统移除） */
export function ruleRemoveCommand(rule: PortForwardRule): string {
  return previewNetshCommand(rule, 'delete')
}

export { ruleSummary }

/** 规则清单摘要（确认框 / 复制摘要） */
export function summarizeRules(rules: readonly PortForwardRule[]): string {
  if (rules.length === 0) return '（无规则）'
  return rules.map((r) => `${r.id}：${ruleSummary(r)}`).join('\n')
}

export interface ProxyForm {
  useWindowsProxy: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
}

export function proxyToForm(proxy: ProxyConfig): ProxyForm {
  return {
    useWindowsProxy: proxy.useWindowsProxy,
    httpProxy: proxy.httpProxy,
    httpsProxy: proxy.httpsProxy,
    noProxy: proxy.noProxy,
  }
}

/**
 * 代理地址基本形态：host:port 或 scheme://host:port。
 * 支持 user:pass@host:port 与 IPv6 字面量（[::1]:7890）；端口须在 1..65535。
 */
export function isValidProxyAddress(value: string): boolean {
  const v = String(value ?? '').trim()
  if (!v) return false
  const noScheme = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const at = noScheme.lastIndexOf('@')
  const hostPort = at >= 0 ? noScheme.slice(at + 1) : noScheme
  const m = /^(\[[0-9a-fA-F:]+\]|[^:\s/]+):(\d{1,5})$/.exec(hostPort)
  if (!m) return false
  const port = Number(m[2])
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * 代理表单校验：全空 = 显式「不配置代理」（允许保存，即关闭代理）；
 * 填写的值不得含空白字符且须满足基本形态。目标是可往返表达「关闭」态，
 * 而不是逼用户留一个假地址；启动时也绝不把垃圾地址写进发行版（review 0.1.2 根治）。
 */
export function validateProxyForm(form: ProxyForm): string | null {
  const http = form.httpProxy.trim()
  const https = form.httpsProxy.trim()
  for (const [label, value] of [
    ['HTTP 代理', http],
    ['HTTPS 代理', https],
  ] as const) {
    if (!value) continue
    if (/\s/.test(value)) return `${label}不能包含空白字符`
    if (!isValidProxyAddress(value)) return `${label}格式应为 host:port 或 scheme://host:port`
  }
  return null
}
