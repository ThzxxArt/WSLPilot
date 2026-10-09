/**
 * /etc/wsl.conf（INI 风格）解析、最小编辑与可视化表单模型 — M5 配置与动作。
 * 纯函数、主/渲染共享：主进程写盘、渲染进程表单/差异预览共用同一实现。
 *
 * 设计要点：
 * - 解析保留行结构（注释/空行/未知行），最小编辑只改动目标键，绝不静默丢注释（设计书 §9.3）
 * - 表单模型只覆盖常见键；未知键原样保留（raw 模式可改）
 */

export type IniLineType = 'blank' | 'comment' | 'section' | 'entry' | 'other'

export interface IniLine {
  type: IniLineType
  raw: string
  /** section 头名称（不含方括号）；entry 行携带所属 section */
  section?: string
  key?: string
  /** 去引号后的值 */
  value?: string
  quoted?: boolean
}

const SECTION_RE = /^\s*\[([^\]]+)]\s*(?:[#;].*)?$/
const ENTRY_RE = /^\s*([^=:#;\s][^=:#;]*?)\s*=\s*(.*?)\s*$/
const COMMENT_RE = /^\s*[#;]/

/** 解析 INI 文本为行模型（保留原文，供最小编辑定位） */
export function parseIniLines(text: string): IniLine[] {
  const lines = text.split(/\r?\n/)
  let section: string | undefined
  const out: IniLine[] = []
  for (const raw of lines) {
    if (raw.trim() === '') {
      out.push({ type: 'blank', raw })
      continue
    }
    const sec = SECTION_RE.exec(raw)
    if (sec) {
      section = sec[1]!.trim()
      out.push({ type: 'section', raw, section })
      continue
    }
    if (COMMENT_RE.test(raw)) {
      out.push({ type: 'comment', raw, section })
      continue
    }
    const entry = ENTRY_RE.exec(raw)
    if (entry) {
      const key = entry[1]!.trim()
      const rawValue = entry[2] ?? ''
      const quoted =
        (rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length >= 2) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'") && rawValue.length >= 2)
      out.push({
        type: 'entry',
        raw,
        section,
        key,
        value: quoted ? rawValue.slice(1, -1) : rawValue,
        quoted,
      })
      continue
    }
    out.push({ type: 'other', raw, section })
  }
  return out
}

/** 取指定键的值（去引号）；不存在返回 undefined */
export function getIniValue(text: string, section: string, key: string): string | undefined {
  const line = parseIniLines(text).find(
    (l) => l.type === 'entry' && l.section === section && l.key === key,
  )
  return line?.value
}

function formatIniValue(value: string | boolean | number): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  // 含空白/引号/# 时加引号（wsl.conf 惯例：options = "metadata,..."）
  return /[\s"'#;]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

/** section 头所在行号范围 [start, end)（含尾部空白行之前的最后一条内容） */
function sectionRange(
  lines: IniLine[],
  section: string,
): { headerIdx: number; bodyStart: number; bodyEnd: number } | null {
  const headerIdx = lines.findIndex((l) => l.type === 'section' && l.section === section)
  if (headerIdx < 0) return null
  let bodyEnd = lines.length
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i]!.type === 'section') {
      bodyEnd = i
      break
    }
  }
  return { headerIdx, bodyStart: headerIdx + 1, bodyEnd }
}

/**
 * 最小编辑设置键值：
 * - 键已存在 → 只替换该行的值
 * - 键不存在 → 在该 section 内容末尾插入
 * - section 不存在 → 文末追加 `[section]` + 键值
 * 其余行（含注释）原样保留。
 */
export function setIniValue(
  text: string,
  section: string,
  key: string,
  value: string | boolean | number,
): string {
  const lines = parseIniLines(text)
  const rendered = formatIniValue(value)
  const range = sectionRange(lines, section)

  if (range) {
    for (let i = range.bodyStart; i < range.bodyEnd; i++) {
      const l = lines[i]!
      if (l.type === 'entry' && l.key === key) {
        lines[i] = { ...l, raw: `${key} = ${rendered}`, value: String(value), quoted: false }
        return lines.map((x) => x.raw).join('\n')
      }
    }
    // 在 section 内容末尾插入（跳过尾部空行，保持视觉紧凑）
    let insertAt = range.bodyEnd
    while (insertAt > range.bodyStart && lines[insertAt - 1]!.type === 'blank') insertAt--
    lines.splice(insertAt, 0, {
      type: 'entry',
      raw: `${key} = ${rendered}`,
      section,
      key,
      value: String(value),
    })
    return lines.map((x) => x.raw).join('\n')
  }

  const sep = lines.length > 0 && lines[lines.length - 1]!.raw !== '' ? ['', ''] : ['']
  const addition = [...sep, `[${section}]`, `${key} = ${rendered}`]
  const base = text === '' ? [] : text.split(/\r?\n/)
  // 去掉 base 尾部空行后统一拼接，避免多层空行堆积
  while (base.length > 0 && base[base.length - 1]!.trim() === '') base.pop()
  return [...base, ...addition].join('\n')
}

/** 最小编辑删除键（含其整行）；键不存在则原样返回 */
export function removeIniKey(text: string, section: string, key: string): string {
  const lines = parseIniLines(text)
  const idx = lines.findIndex((l) => l.type === 'entry' && l.section === section && l.key === key)
  if (idx < 0) return text
  lines.splice(idx, 1)
  return lines.map((x) => x.raw).join('\n')
}

// ─────────────────────── wsl.conf 表单模型 ───────────────────────

export interface WslConfModel {
  automount: {
    enabled?: boolean
    root?: string
    options?: string
    mountFsTab?: boolean
  }
  network: {
    generateHosts?: boolean
    generateResolvConf?: boolean
    hostname?: string
  }
  interop: {
    enabled?: boolean
    appendWindowsPath?: boolean
  }
  user: {
    default?: string
  }
  boot: {
    systemd?: boolean
    command?: string
    initTimeout?: number
  }
}

export function emptyWslConfModel(): WslConfModel {
  return {
    automount: {},
    network: {},
    interop: {},
    user: {},
    boot: {},
  }
}

export type WslConfFieldType = 'boolean' | 'string' | 'number'

export interface WslConfField {
  section: keyof WslConfModel
  key: string
  type: WslConfFieldType
  label: string
  hint?: string
  placeholder?: string
}

/** 可视化表单字段目录（唯一事实源） */
export const WSL_CONF_FIELDS: WslConfField[] = [
  {
    section: 'automount',
    key: 'enabled',
    type: 'boolean',
    label: '自动挂载 Windows 驱动器',
    hint: 'automount.enabled — 关闭后 /mnt 下不再自动出现盘符',
  },
  {
    section: 'automount',
    key: 'root',
    type: 'string',
    label: '挂载根目录',
    hint: 'automount.root',
    placeholder: '/mnt/',
  },
  {
    section: 'automount',
    key: 'options',
    type: 'string',
    label: '挂载选项',
    hint: 'automount.options — 逗号分隔，如 metadata,umask=22,fmask=11',
    placeholder: 'metadata,umask=22,fmask=11',
  },
  {
    section: 'automount',
    key: 'mountFsTab',
    type: 'boolean',
    label: '挂载 /etc/fstab 条目',
    hint: 'automount.mountFsTab',
  },
  {
    section: 'network',
    key: 'generateHosts',
    type: 'boolean',
    label: '自动生成 /etc/hosts',
    hint: 'network.generateHosts',
  },
  {
    section: 'network',
    key: 'generateResolvConf',
    type: 'boolean',
    label: '自动生成 /etc/resolv.conf',
    hint: 'network.generateResolvConf — 关闭后可自定义 DNS',
  },
  {
    section: 'network',
    key: 'hostname',
    type: 'string',
    label: '主机名',
    hint: 'network.hostname — 与 Windows 主机名不同步时使用',
  },
  {
    section: 'interop',
    key: 'enabled',
    type: 'boolean',
    label: '允许运行 Windows 程序',
    hint: 'interop.enabled',
  },
  {
    section: 'interop',
    key: 'appendWindowsPath',
    type: 'boolean',
    label: 'PATH 追加 Windows 路径',
    hint: 'interop.appendWindowsPath',
  },
  {
    section: 'user',
    key: 'default',
    type: 'string',
    label: '默认登录用户',
    hint: 'user.default',
  },
  {
    section: 'boot',
    key: 'systemd',
    type: 'boolean',
    label: '启用 systemd',
    hint: 'boot.systemd — 需 WSL 0.67.6+',
  },
  {
    section: 'boot',
    key: 'command',
    type: 'string',
    label: '启动命令',
    hint: 'boot.command — 发行版启动时执行',
  },
  {
    section: 'boot',
    key: 'initTimeout',
    type: 'number',
    label: '启动超时（毫秒）',
    hint: 'boot.initTimeout',
    placeholder: '10000',
  },
] as const

/** 文本值 → 表单类型值；无法识别返回 undefined（视为未设置） */
export function coerceWslConfValue(
  type: WslConfFieldType,
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
  return t
}

/** 解析 wsl.conf 文本 → 表单模型（仅已知字段） */
export function parseWslConf(text: string): WslConfModel {
  const model = emptyWslConfModel()
  for (const f of WSL_CONF_FIELDS) {
    const raw = getIniValue(text, f.section, f.key)
    const v = coerceWslConfValue(f.type, raw)
    if (v === undefined) continue
    ;(model[f.section] as Record<string, unknown>)[f.key] = v
  }
  return model
}

/** 收集文本中不属于表单目录的键（展示「其他设置」，防止用户数据被无视） */
export function collectUnknownKeys(
  text: string,
): Array<{ section: string; key: string; value: string }> {
  const known = new Set(WSL_CONF_FIELDS.map((f) => `${f.section}.${f.key}`))
  const out: Array<{ section: string; key: string; value: string }> = []
  for (const l of parseIniLines(text)) {
    if (l.type !== 'entry' || !l.section || !l.key) continue
    if (known.has(`${l.section}.${l.key}`)) continue
    out.push({ section: l.section, key: l.key, value: l.value ?? '' })
  }
  return out
}

export interface WslConfChange {
  section: string
  key: string
  before?: string
  after?: string
  kind: 'set' | 'remove'
}

/**
 * 把表单模型应用到原文（最小编辑）。
 * 语义（防静默丢用户数据）：
 * - 模型中 undefined = 不触碰该键（未编辑）
 * - 字符串字段显式置空串 = 清除该键
 * - opts.removeKeys 中显式标记（`section.key`）= 清除该键
 * 返回新文本与逐键变更清单（供差异预览）。
 */
export function applyWslConfModel(
  text: string,
  model: WslConfModel,
  opts: { removeKeys?: readonly string[] } = {},
): { text: string; changes: WslConfChange[] } {
  let out = text
  const changes: WslConfChange[] = []
  const removeKeys = new Set(opts.removeKeys ?? [])
  for (const f of WSL_CONF_FIELDS) {
    const id = `${f.section}.${f.key}`
    const before = getIniValue(out, f.section, f.key)
    const next = (model[f.section] as Record<string, unknown>)[f.key]
    const cleared = removeKeys.has(id) || (f.type === 'string' && next === '')
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

// ─────────────────────── 行级差异（Diff 预览） ───────────────────────

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
  /** 1 基行号 */
  oldLine?: number
  newLine?: number
}

/**
 * 行级 LCS 差异。配置文件体量小（wsl.conf ≤ 64KB），O(n·m) 足够。
 * 输出顺序：删除行先于新增行（便于阅读）。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split(/\r?\n/)
  const b = newText === '' ? [] : newText.split(/\r?\n/)
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS 长度（a[i:], b[j:]）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]!, oldLine: i + 1, newLine: j + 1 })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]!, oldLine: i + 1 })
      i++
    } else {
      out.push({ type: 'add', text: b[j]!, newLine: j + 1 })
      j++
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: a[i]!, oldLine: i + 1 })
    i++
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j]!, newLine: j + 1 })
    j++
  }
  return out
}

/** 差异是否为空（保存前判断是否需要写盘） */
export function isSameText(a: string, b: string): boolean {
  return diffLines(a, b).every((d) => d.type === 'same')
}
