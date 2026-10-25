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
import { WSL_SIZE_RE, wslSizeToBytes } from './commands'

export type WslConfigSection = 'wsl2' | 'general' | 'experimental'

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
    localhostForwarding?: boolean
    safeMode?: boolean
    guiApplications?: boolean
    nestedVirtualization?: boolean
    vmIdleTimeout?: number
    dnsProxy?: boolean
    defaultVhdSize?: string
    gpuSupport?: boolean
    maxCrashDumpCount?: number
    kernel?: string
    kernelCommandLine?: string
  }
  general: {
    instanceIdleTimeout?: number
    distributionInstallPath?: string
  }
  experimental: {
    autoMemoryReclaim?: string
    sparseVhd?: boolean
    bestEffortDnsParsing?: boolean
    ignoredPorts?: string
    hostAddressLoopback?: boolean
  }
}

export function emptyWslConfigModel(): WslConfigModel {
  return { wsl2: {}, general: {}, experimental: {} }
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
  /** 允许用户输入列表外的值（WSL 对未知 enum 有明确回退语义时使用） */
  allowCustom?: boolean
  /** size 类型允许字面 `0`（swap=0 语义为禁用交换；memory 不允许） */
  allowZero?: boolean
  /** number 类型范围 */
  min?: number
  max?: number
}

/** WSL 容量语法（与 WSL ParseMemorySize 同源，见 commands.ts）：整数 + B/K/KB/M/MB/G/GB/T/TB */
export const SIZE_VALUE_RE = WSL_SIZE_RE

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
    min: 1,
    max: 256,
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
    hint: 'wsl2.networkingMode — mirrored 共用网络栈；none 断开网络；consomme 为旧 virtioproxy 的新名字',
    options: ['nat', 'mirrored', 'none', 'consomme', 'bridged'],
    allowCustom: true,
  },
  {
    section: 'wsl2',
    key: 'dnsTunneling',
    type: 'boolean',
    label: 'DNS 隧道',
    hint: 'wsl2.dnsTunneling — 通过虚拟化管道解析 DNS，兼容 VPN/特殊网络（Win11 22H2+）',
  },
  {
    section: 'wsl2',
    key: 'firewall',
    type: 'boolean',
    label: 'Windows 防火墙集成',
    hint: 'wsl2.firewall — 应用 Hyper-V 防火墙规则到 WSL（Win11 22H2+）',
  },
  {
    section: 'wsl2',
    key: 'autoProxy',
    type: 'boolean',
    label: '自动代理继承',
    hint: 'wsl2.autoProxy — 自动把 Windows 代理设置带入 WSL 环境变量（Win11）',
  },
  {
    section: 'wsl2',
    key: 'localhostForwarding',
    type: 'boolean',
    label: 'localhost 转发',
    hint: 'wsl2.localhostForwarding — 允许从 Windows 通过 localhost 访问 WSL 内端口',
  },
  {
    section: 'wsl2',
    key: 'safeMode',
    type: 'boolean',
    label: '安全模式',
    hint: 'wsl2.safeMode — 禁用大量功能，仅用于恢复损坏的发行版（Win11，WSL 0.66.2+）',
  },
  {
    section: 'wsl2',
    key: 'guiApplications',
    type: 'boolean',
    label: 'GUI 应用（WSLg）',
    hint: 'wsl2.guiApplications — 允许运行 Linux GUI 应用',
  },
  {
    section: 'wsl2',
    key: 'nestedVirtualization',
    type: 'boolean',
    label: '嵌套虚拟化',
    hint: 'wsl2.nestedVirtualization — 允许在 WSL2 内再运行虚拟机（Win11）',
  },
  {
    section: 'wsl2',
    key: 'vmIdleTimeout',
    type: 'number',
    label: 'VM 空闲超时（ms）',
    hint: 'wsl2.vmIdleTimeout — VM 空闲多久后关闭（默认 60000，Win11）',
    placeholder: '60000',
    min: 0,
    max: 86_400_000,
  },
  {
    section: 'wsl2',
    key: 'dnsProxy',
    type: 'boolean',
    label: 'NAT DNS 代理',
    hint: 'wsl2.dnsProxy — 仅 NAT 模式：关闭后把 Windows DNS 服务器镜像进 Linux',
  },
  {
    section: 'wsl2',
    key: 'defaultVhdSize',
    type: 'size',
    label: '默认虚拟磁盘上限',
    hint: 'wsl2.defaultVhdSize — 新建发行版 VHD 的默认上限（默认 1TB）',
    placeholder: '1TB',
  },
  {
    section: 'wsl2',
    key: 'gpuSupport',
    type: 'boolean',
    label: 'GPU 支持',
    hint: 'wsl2.gpuSupport — 在 WSL2 VM 中启用 GPU 支持',
  },
  {
    section: 'wsl2',
    key: 'maxCrashDumpCount',
    type: 'number',
    label: '崩溃转储保留数',
    hint: 'wsl2.maxCrashDumpCount — 最多保留多少个崩溃转储文件（默认 10）',
    placeholder: '10',
    min: 0,
    max: 1000,
  },
  {
    section: 'wsl2',
    key: 'kernel',
    type: 'string',
    label: '自定义内核路径',
    hint: 'wsl2.kernel — 绝对 Windows 路径；留空使用微软内核',
    placeholder: 'C:\\Temp\\myCustomKernel',
  },
  {
    section: 'wsl2',
    key: 'kernelCommandLine',
    type: 'string',
    label: '内核命令行',
    hint: 'wsl2.kernelCommandLine — 追加的内核启动参数',
    placeholder: 'vsyscall=emulate',
  },
  {
    section: 'general',
    key: 'instanceIdleTimeout',
    type: 'number',
    label: '发行版空闲超时（ms）',
    hint: 'general.instanceIdleTimeout — 发行版空闲多久后关闭；-1 禁用自动关闭（默认 15000）',
    placeholder: '15000',
    min: -1,
    max: 86_400_000,
  },
  {
    section: 'general',
    key: 'distributionInstallPath',
    type: 'string',
    label: '默认安装目录',
    hint: 'general.distributionInstallPath — 新发行版的默认安装目录（默认 %LocalAppData%\\wsl）',
    placeholder: 'D:\\WSL',
  },
  {
    section: 'experimental',
    key: 'autoMemoryReclaim',
    type: 'enum',
    label: '内存自动回收',
    hint: 'experimental.autoMemoryReclaim — 空闲时把缓存内存归还 Windows；未知值按 dropCache 处理',
    options: ['disabled', 'gradual', 'dropCache'],
    allowCustom: true,
  },
  {
    section: 'experimental',
    key: 'sparseVhd',
    type: 'boolean',
    label: '稀疏虚拟磁盘',
    hint: 'experimental.sparseVhd — 新建发行版磁盘按需增长（已存在的发行版需 wsl --manage --set-sparse）',
  },
  {
    section: 'experimental',
    key: 'bestEffortDnsParsing',
    type: 'boolean',
    label: '尽力 DNS 解析',
    hint: 'experimental.bestEffortDnsParsing — DNS 隧道开启时忽略未知记录（Win11 22H2+）',
  },
  {
    section: 'experimental',
    key: 'ignoredPorts',
    type: 'string',
    label: '忽略端口',
    hint: 'experimental.ignoredPorts — 镜像模式下允许 Linux 绑定的 Windows 已占用端口，逗号分隔',
    placeholder: '3000,9000,9090',
  },
  {
    section: 'experimental',
    key: 'hostAddressLoopback',
    type: 'boolean',
    label: '宿主地址回环',
    hint: 'experimental.hostAddressLoopback — 镜像模式下允许通过宿主 IP 互访（Win11 22H2+）',
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
      if (!SIZE_VALUE_RE.test(s)) {
        return `${field.label}格式应为整数 + B/K/KB/M/MB/G/GB/T/TB（如 8GB；WSL 不接受小数）`
      }
      if (!field.allowZero && wslSizeToBytes(s) === 0) {
        return `${field.label}不能为 0`
      }
      return null
    case 'number': {
      const n = Number(s)
      const min = field.min ?? 1
      const max = field.max ?? 256
      if (!Number.isInteger(n) || n < min || n > max) {
        return `${field.label}应为 ${min}–${max} 的整数`
      }
      return null
    }
    case 'enum':
      // WSL 对未知 enum 有明确回退语义（如 networkingMode 未知 → NAT；
      // autoMemoryReclaim 未知 → dropCache）：允许保存，但 UI 必须标注“不在推荐列表”。
      if (field.allowCustom) return null
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
    const coerced = coerceWslConfigValue(f.type, raw)
    if (coerced === undefined) continue
    const v =
      typeof coerced === 'string' && f.type === 'enum'
        ? canonicalWslConfigValue(f, coerced)
        : coerced
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

/** 枚举值规范写法：读兼容大小写，写回规范值（避免同一语义两种写法反复漂移） */
export function canonicalWslConfigValue(field: WslConfigField, value: string): string {
  if (field.key === 'autoMemoryReclaim') {
    return value.toLowerCase() === 'dropcache' ? 'dropCache' : value
  }
  if (field.key === 'networkingMode') return value.toLowerCase()
  return value
}

/**
 * 模型值与磁盘原值是否语义相同（用于避免“只是大小写/规范名不同”就写盘）。
 * 关键：`dropcache` 与 `dropCache`、`NAT` 与 `nat` 是同一 WSL 语义，加载后
 * 不应因此把文件标记为 dirty 或重写用户的选择。
 */
function sameEffectiveValue(
  field: WslConfigField,
  before: string | undefined,
  next: unknown,
): boolean {
  if (before === undefined) return false
  if (field.type === 'boolean') {
    const b = /^(true|1|yes|on)$/i.test(before.trim())
      ? true
      : /^(false|0|no|off)$/i.test(before.trim())
        ? false
        : undefined
    return b === next
  }
  if (field.type === 'enum') {
    return (
      canonicalWslConfigValue(field, before).toLowerCase() ===
      canonicalWslConfigValue(field, String(next)).toLowerCase()
    )
  }
  if (field.type === 'number') return Number(before) === Number(next)
  return before.trim() === String(next).trim()
}

/**
 * 把表单模型应用到原文（最小编辑）。
 * 语义（与 `applyWslConfModel` 一致，防静默丢用户数据）：
 * - 模型中 undefined = 不触碰该键（未编辑）
 * - 字符串字段显式置空串 = 清除该键
 * - opts.removeKeys 中显式标记（`section.key`）= 清除该键
 * - 值语义未变（大小写/规范枚举名）不写盘，避免加载即 dirty
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
    const after = canonicalWslConfigValue(f, String(next))
    if (sameEffectiveValue(f, before, next)) continue
    out = setIniValue(out, f.section, f.key, after)
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
