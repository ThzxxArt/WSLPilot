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

export type RuleSystemState = 'applied' | 'listening' | 'mismatch' | 'none' | 'udp-only'

/** `addr:port` 展示（IPv6 用 [] 包裹） */
export function formatRuleRange(address: string, port: number): string {
  const addr = String(address ?? '').trim()
  const host = addr.includes(':') && !addr.startsWith('[') ? `[${addr}]` : addr
  return `${host}:${port}`
}

/** 规则与系统转发表的对照状态（表格状态列） */
export function ruleSystemState(
  rule: PortForwardRule,
  status: NetworkStatus | null,
): RuleSystemState {
  if (!canApplyRule(rule)) return 'udp-only'
  const entries = status?.portProxy ?? []
  const listened = entries.find(
    (e) => e.listenAddress === rule.listenAddress && e.listenPort === rule.listenPort,
  )
  if (!listened) return 'none'
  const exact = entries.some(
    (e) =>
      e.listenAddress === rule.listenAddress &&
      e.listenPort === rule.listenPort &&
      e.connectAddress === rule.connectAddress &&
      e.connectPort === rule.connectPort,
  )
  return exact ? 'applied' : 'mismatch'
}

const SYSTEM_STATE_LABEL: Record<RuleSystemState, string> = {
  applied: '已生效',
  listening: '监听中',
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

/** 代理表单校验：至少有一项生效，否则提示（允许清空，但要显式确认语义） */
export function validateProxyForm(form: ProxyForm): string | null {
  const http = form.httpProxy.trim()
  const https = form.httpsProxy.trim()
  if (!form.useWindowsProxy && !http && !https) {
    return '请填写 HTTP/HTTPS 代理地址，或开启「跟随系统代理」'
  }
  for (const [label, value] of [
    ['HTTP 代理', http],
    ['HTTPS 代理', https],
  ] as const) {
    if (!value) continue
    if (/\s/.test(value)) return `${label}不能包含空白字符`
  }
  return null
}
