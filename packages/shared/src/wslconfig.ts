/**
 * `%UserProfile%\.wslconfig`（全局配置，INI 风格）解析、最小编辑与可视化表单模型 — 0.1.3。
 *
 * 与 `wslconf.ts`（发行版内 /etc/wsl.conf）共用同一套行级 INI 机制（parseIniLines /
 * setIniValue / removeIniKey），本模块只定义 `.wslconfig` 的字段目录、类型校验与表单应用。
 * 纯函数、主/渲染共享：主进程写盘、渲染进程表单/差异预览共用同一实现。
 *
 * 设计要点：
 * - 解析保留行结构（注释/空行/未知行），最小编辑只改动目标键，绝不静默丢注释
 * - 表单覆盖常见键（[wsl2] / [experimental]）；未知键原样保留（raw 模式可改）
 * - `networkingMode` 的读取与 `network.ts` 的镜像模式检测同源（单一解析器）
 */
import {
  parseIniLines,
  getIniValue,
  setIniValue,
  removeIniKey,
  type WslConfChange,
} from './wslconf'

export type WslConfigSection = 'wsl2' | 'experimental'

export interface WslConfigModel {
  wsl2: {
    memory?: string
    processors?: number
    swap?: string
    swapFile?: string
    networkingMode?: string
    dnsTunneling?: boolean
    firewall?: boolean
    autoProxy?: boolean
  }
  experimental: {
    autoMemoryReclaim?: string
    sparseVhd?: boolean
  }
}

export function emptyWslConfigModel(): WslConfigModel {
  return { wsl2: {}, experimental: {} }
}

export type WslConfigFieldType = 'boolean' | 'string' | 'number' | 'size' | 'enum'

export interface WslConfigField {
  section: WslConfigSection
  key: string
  type: WslConfigFieldType
  label: string
  hint?: string
  placeholder?: string
  /** enum 可选值 */
  options?: readonly string[]
  /** size 类型允许字面 `0`（swap=0 语义为禁用交换；memory 不允许） */
  allowZero?: boolean
}

/** 带单位容量（memory / swap）：`512MB` / `8GB`（不区分大小写） */
export const SIZE_VALUE_RE = /^\d+(?:\.\d+)?(?:MB|GB)$/i

/** 可视化表单字段目录（唯一事实源；字段归属段落与官方 `.wslconfig` 文档对齐） */
export const WSL_CONFIG_FIELDS: readonly WslConfigField[] = [
  {
    section: 'wsl2',
    key: 'memory',
    type: 'size',
    label: '内存上限',
    hint: 'wsl2.memory — 如 8GB / 4096MB；未设置使用默认（宿主内存的 50%）',
    placeholder: '8GB',
  },
  {
    section: 'wsl2',
    key: 'processors',
    type: 'number',
    label: '处理器数量',
    hint: 'wsl2.processors — 留空使用全部逻辑处理器',
    placeholder: '4',
  },
  {
    section: 'wsl2',
    key: 'swap',
    type: 'size',
    label: '交换空间大小',
    hint: 'wsl2.swap — 如 2GB；填 0 禁用交换',
    placeholder: '2GB',
    allowZero: true,
  },
  {
    section: 'wsl2',
    key: 'swapFile',
    type: 'string',
    label: '交换文件路径',
    hint: 'wsl2.swapFile — 默认 %USERPROFILE%\\AppData\\Local\\Temp\\swap.vhdx',
    placeholder: 'D:\\WSL\\swap.vhdx',
  },
  {
    section: 'wsl2',
    key: 'networkingMode',
    type: 'enum',
    label: '网络模式',
    hint: 'wsl2.networkingMode — mirrored 与 Windows 共用网络栈（VPN/本地服务更可靠）',
    options: ['nat', 'mirrored'],
  },
  {
    section: 'wsl2',
    key: 'dnsTunneling',
    type: 'boolean',
    label: 'DNS 隧道',
    hint: 'wsl2.dnsTunneling — 通过虚拟化管道解析 DNS，兼容 VPN/特殊网络',
  },
  {
    section: 'wsl2',
    key: 'firewall',
    type: 'boolean',
    label: 'Windows 防火墙集成',
    hint: 'wsl2.firewall — 应用 Hyper-V 防火墙规则到 WSL',
  },
  {
    section: 'wsl2',
    key: 'autoProxy',
    type: 'boolean',
    label: '自动代理继承',
    hint: 'wsl2.autoProxy — 自动把 Windows 代理设置带入 WSL 环境变量',
  },
  {
    section: 'experimental',
    key: 'autoMemoryReclaim',
    type: 'enum',
    label: '内存自动回收',
    hint: 'experimental.autoMemoryReclaim — 空闲时把缓存内存归还 Windows',
    options: ['disabled', 'gradual', 'dropcache'],
  },
  {
    section: 'experimental',
    key: 'sparseVhd',
    type: 'boolean',
    label: '稀疏虚拟磁盘',
    hint: 'experimental.sparseVhd — 新建发行版磁盘按需增长（已存在的发行版需 wsl --manage --set-sparse）',
  },
] as const

/**
 * 字段值校验（渲染层与执行边界共用）。
 * 返回中文错误文案；合法返回 null。空字符串表示「清除该键」，视为合法。
 */
export function validateWslConfigValue(field: WslConfigField, raw: string): string | null {
  const s = raw.trim()
  if (s === '') return null
  switch (field.type) {
    case 'size':
      if (field.allowZero && s === '0') return null
      if (!SIZE_VALUE_RE.test(s)) return `${field.label}格式应为数字 + MB/GB（如 8GB）`
      return null
    case 'number': {
      const n = Number(s)
      if (!Number.isInteger(n) || n < 1 || n > 256) return `${field.label}应为 1–256 的整数`
      return null
    }
    case 'enum':
      if (!(field.options ?? []).includes(s)) {
        return `${field.label}只能取：${(field.options ?? []).join(' / ')}`
      }
      return null
    default:
      return null
  }
}

/** 文本值 → 表单类型值；无法识别返回 undefined（视为未设置） */
function coerceWslConfigValue(
  type: WslConfigFieldType,
  raw: string | undefined,
): boolean | string | number | undefined {
  if (raw === undefined) return undefined
  const t = raw.trim()
  if (type === 'boolean') {
    if (/^(true|1|yes|on)$/i.test(t)) return true
    if (/^(false|0|no|off)$/i.test(t)) return false
    return undefined
  }
  if (type === 'number') {
    const n = Number(t)
    return Number.isFinite(n) ? n : undefined
  }
  if (type === 'enum') {
    return t.toLowerCase()
  }
  return t
}

/** 解析 .wslconfig 文本 → 表单模型（仅已知字段） */
export function parseWslConfigModel(text: string): WslConfigModel {
  const model = emptyWslConfigModel()
  for (const f of WSL_CONFIG_FIELDS) {
    const raw = getIniValue(text, f.section, f.key)
    const v = coerceWslConfigValue(f.type, raw)
    if (v === undefined) continue
    ;(model[f.section] as Record<string, unknown>)[f.key] = v
  }
  return model
}

/** 收集文本中不属于表单目录的键（展示「其他设置」，防止用户数据被无视） */
export function collectUnknownWslConfigKeys(
  text: string,
): Array<{ section: string; key: string; value: string }> {
  // 大小写不敏感（与 getIniValue/setIniValue 的 INI 语义一致）：大小写变化的已知键
  // 不得同时出现在表单与其他设置（否则保存会产生重复语义键）
  const known = new Set(WSL_CONFIG_FIELDS.map((f) => `${f.section}.${f.key}`.toLowerCase()))
  const out: Array<{ section: string; key: string; value: string }> = []
  for (const l of parseIniLines(text)) {
    if (l.type !== 'entry' || !l.section || !l.key) continue
    if (known.has(`${l.section}.${l.key}`.toLowerCase())) continue
    out.push({ section: l.section, key: l.key, value: l.value ?? '' })
  }
  return out
}

/**
 * 把表单模型应用到原文（最小编辑）。
 * 语义（与 `applyWslConfModel` 一致，防静默丢用户数据）：
 * - 模型中 undefined = 不触碰该键（未编辑）
 * - 字符串字段显式置空串 = 清除该键
 * - opts.removeKeys 中显式标记（`section.key`）= 清除该键
 * 返回新文本与逐键变更清单（供差异预览）。
 */
export function applyWslConfigModel(
  text: string,
  model: WslConfigModel,
  opts: { removeKeys?: readonly string[] } = {},
): { text: string; changes: WslConfChange[] } {
  let out = text
  const changes: WslConfChange[] = []
  const removeKeys = new Set(opts.removeKeys ?? [])
  for (const f of WSL_CONFIG_FIELDS) {
    const id = `${f.section}.${f.key}`
    const before = getIniValue(out, f.section, f.key)
    const next = (model[f.section] as Record<string, unknown>)[f.key]
    const cleared = removeKeys.has(id) || (f.type !== 'boolean' && next === '')
    if (cleared) {
      if (before === undefined) continue
      out = removeIniKey(out, f.section, f.key)
      changes.push({ section: f.section, key: f.key, before, kind: 'remove' })
      continue
    }
    if (next === undefined) continue
    const after = String(next)
    if (before === after) continue
    out = setIniValue(out, f.section, f.key, next as string | boolean | number)
    changes.push({ section: f.section, key: f.key, before, after, kind: 'set' })
  }
  return { text: out, changes }
}

/** 变更清单 → 展示文案（差异预览标题栏摘要） */
export function summarizeWslConfigChanges(changes: WslConfChange[]): string {
  if (changes.length === 0) return '无变更'
  const sets = changes.filter((c) => c.kind === 'set').length
  const removes = changes.filter((c) => c.kind === 'remove').length
  const parts: string[] = []
  if (sets > 0) parts.push(`${sets} 项修改`)
  if (removes > 0) parts.push(`${removes} 项删除`)
  return parts.join(' · ')
}
