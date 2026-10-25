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
  /** 值后的行内注释（含前导空白）；最小编辑时原样保留 */
  inlineComment?: string
}

const SECTION_RE = /^\s*\[([^\]]+)]\s*(?:[#;].*)?$/
const ENTRY_RE = /^\s*([^=:#;\s][^=:#;]*?)\s*=\s*(.*?)\s*$/
const COMMENT_RE = /^\s*#/

/**
 * 去引号并反转 WSL 配置解析器的转义（`\\` `\"` `\n` `\t` `\b`）。
 * Microsoft WSL 的 configfile.cpp 只把双引号视为引号；单引号是普通字符。
 * 因此这里**不再剥单引号**，否则 UI 会显示一个 WSL 实际看到带引号的值。
 * 未知转义保持字面（WSL 会告警，但读取不能丢用户数据）。
 */
function decodeIniEscapes(body: string): string {
  return body.replace(/\\(["\\ntb])/g, (_m, ch: string) => {
    if (ch === 'n') return '\n'
    if (ch === 't') return '\t'
    if (ch === 'b') return '\b'
    return ch
  })
}

function unquoteIni(raw: string): { value: string; quoted: boolean } {
  if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
    return { value: decodeIniEscapes(raw.slice(1, -1)), quoted: true }
  }
  return { value: decodeIniEscapes(raw), quoted: false }
}

/**
 * 拆分「值本体 + 行内注释」。
 * - 引号值：找到匹配的收尾双引号，其后全部是注释/空白
 * - 裸值：`空白 + #` 之后视为注释（WSL configfile.cpp 只认 `#`；
 *   `;` 在 WSL 里是普通字符，不能当注释吞掉值）
 */
function splitValueAndComment(afterEq: string): { rawValue: string; comment: string } {
  const leading = /^\s*/.exec(afterEq)?.[0] ?? ''
  const body = afterEq.slice(leading.length)
  if (body.startsWith('"')) {
    let escaped = false
    for (let i = 1; i < body.length; i++) {
      const ch = body[i]!
      if (ch === '\\' && !escaped) {
        escaped = true
        continue
      }
      if (ch === '"' && !escaped) {
        return { rawValue: body.slice(0, i + 1), comment: body.slice(i + 1) }
      }
      escaped = false
    }
    // 引号未闭合：按裸值处理（不静默吞整行）
  }
  // WSL 的 configfile.cpp 在引号外遇到任意 `#` 就结束值（不要求前面有空白）。
  const hash = body.indexOf('#')
  if (hash >= 0) {
    let commentStart = hash
    while (commentStart > 0 && /\s/.test(body[commentStart - 1]!)) commentStart--
    return { rawValue: body.slice(0, commentStart), comment: body.slice(commentStart) }
  }
  return { rawValue: body, comment: '' }
}

/** 解析 INI 文本为行模型（保留原文，供最小编辑定位） */
/** 行尾未转义的反斜杠 = WSL configfile.cpp 的行续接（`\\` 是字面反斜杠）。 */
function hasLineContinuation(raw: string): boolean {
  const m = /\\+$/.exec(raw)
  return m ? m[0].length % 2 === 1 : false
}

export function parseIniLines(text: string): IniLine[] {
  const lines = text.split(/\r?\n/)
  let section: string | undefined
  const out: IniLine[] = []
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i]!
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
    // WSL：反斜杠 + 换行是续接，逻辑上属于同一条 value。先拼成一个逻辑行，
    // 再交给 ENTRY_RE；写回时会自然收敛为单行，不会留下孤立的续接物理行。
    // 行内注释里的行尾反斜杠不是续接（注释吞到换行），不能把下一行并进值。
    while (hasLineContinuation(raw) && i + 1 < lines.length) {
      const provisional = ENTRY_RE.exec(raw)
      if (!provisional || splitValueAndComment(provisional[2] ?? '').comment) break
      raw = raw.slice(0, -1) + lines[++i]!
    }
    const entry = ENTRY_RE.exec(raw)
    if (entry) {
      const key = entry[1]!.trim()
      const { rawValue, comment } = splitValueAndComment(entry[2] ?? '')
      const unquoted = unquoteIni(rawValue.trim())
      out.push({
        type: 'entry',
        raw,
        section,
        key,
        value: unquoted.value,
        quoted: unquoted.quoted,
        inlineComment: comment,
      })
      continue
    }
    out.push({ type: 'other', raw, section })
  }
  return out
}

/** 取指定键的值（去引号）；不存在返回 undefined */
/** INI 语义：段落名 / 键名大小写不敏感（WSL 自身与旧镜像解析同此 — 0.1.3 审计对齐） */
function sameIniToken(a: string | undefined, b: string): boolean {
  return (a ?? '').toLowerCase() === b.toLowerCase()
}

export function getIniValue(text: string, section: string, key: string): string | undefined {
  // WSL configfile.cpp 的 ConfigKey::Parse 对重复键只接受**第一处**，后续重复项告警忽略。
  // 读取必须与 WSL 生效值同语义；此前“last wins”会让 UI 显示一个 WSL 根本不用的值。
  const line = parseIniLines(text).find(
    (l) => l.type === 'entry' && sameIniToken(l.section, section) && sameIniToken(l.key, key),
  )
  return line?.value
}

function formatIniValue(value: string | boolean | number): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  // WSL 的 configfile.cpp 只识别双引号；反斜杠在引号内外都会被当作转义起始，
  // 因此含空白/#/引号/反斜杠的值必须加双引号，并把 `\` 与 `"` 转义。
  if (!/[\s"'#;\\]/.test(value)) return value
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    // eslint-disable-next-line no-control-regex -- 退格是 WSL 的 \b 转义
    .replace(/\u0008/g, '\\b')}"`
}

/**
 * section 头所在行号范围 [start, end)：重复段取**第一处**。
 * WSL 对重复键取第一处生效，编辑/插入都应落在生效段。
 */
function sectionRange(
  lines: IniLine[],
  section: string,
): { headerIdx: number; bodyStart: number; bodyEnd: number } | null {
  const headerIdx = lines.findIndex((l) => l.type === 'section' && sameIniToken(l.section, section))
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

/** 只替换 `=` 右侧的值片段：保留键写法、等号旁空白、行内注释 */
function replaceEntryValue(line: IniLine, rendered: string): string {
  const eq = line.raw.indexOf('=')
  if (eq < 0) return line.raw
  const after = line.raw.slice(eq + 1)
  const leading = /^\s*/.exec(after)?.[0] ?? ''
  return `${line.raw.slice(0, eq + 1)}${leading}${rendered}${line.inlineComment ?? ''}`
}

/**
 * 最小编辑设置键值：
 * - 键已存在 → 只替换该行的值（保留行内注释）
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

  // 生效键 = 文件中第一处同名 section/key（WSL first-wins）；必须改这一处，
  // 否则改后面的重复项对 WSL 完全没有效果。
  const effectiveIdx = lines.findIndex(
    (l) => l.type === 'entry' && sameIniToken(l.section, section) && sameIniToken(l.key, key),
  )
  if (effectiveIdx >= 0) {
    const l = lines[effectiveIdx]!
    lines[effectiveIdx] = { ...l, raw: replaceEntryValue(l, rendered), value: String(value) }
    return lines.map((x) => x.raw).join('\n')
  }

  const range = sectionRange(lines, section)
  if (range) {
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

/**
 * 最小编辑删除键（含其整行）。
 * 重复键/重复段：删除**全部**同名键——只删最后一处会让更早的旧值“复活”，
 * 与用户看到的“清除”语义不符。
 */
export function removeIniKey(text: string, section: string, key: string): string {
  const lines = parseIniLines(text)
  const kept = lines.filter(
    (l) => !(l.type === 'entry' && sameIniToken(l.section, section) && sameIniToken(l.key, key)),
  )
  if (kept.length === lines.length) return text
  return kept.map((x) => x.raw).join('\n')
}

// ─────────────────────── wsl.conf 表单模型 ───────────────────────

export interface WslConfModel {
  automount: {
    enabled?: boolean
    root?: string
    options?: string
    mountFsTab?: boolean
    ldconfig?: boolean
    cgroups?: string
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
    protectBinfmt?: boolean
  }
  gpu: {
    enabled?: boolean
    appendLibPath?: boolean
  }
  time: {
    useWindowsTimezone?: boolean
  }
}

export function emptyWslConfModel(): WslConfModel {
  return {
    automount: {},
    network: {},
    interop: {},
    user: {},
    boot: {},
    gpu: {},
    time: {},
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
  {
    section: 'boot',
    key: 'protectBinfmt',
    type: 'boolean',
    label: '保护 binfmt 注册',
    hint: 'boot.protectBinfmt — 防止 systemd 覆盖 WSL 的 binfmt 单元（默认 true）',
  },
  {
    section: 'automount',
    key: 'ldconfig',
    type: 'boolean',
    label: '运行 ldconfig',
    hint: 'automount.ldconfig — 把 Windows 提供的 GPU 库加入动态链接搜索路径（WSL2）',
  },
  {
    section: 'automount',
    key: 'cgroups',
    type: 'string',
    label: 'cgroup 版本',
    hint: 'automount.cgroups — v1 或 v2（默认 v2）',
    placeholder: 'v2',
  },
  {
    section: 'gpu',
    key: 'enabled',
    type: 'boolean',
    label: '允许 GPU 加速',
    hint: 'gpu.enabled — 允许 Linux 应用通过半虚拟化访问 Windows GPU',
  },
  {
    section: 'gpu',
    key: 'appendLibPath',
    type: 'boolean',
    label: '追加 GPU 库路径',
    hint: 'gpu.appendLibPath — 把 /usr/lib/wsl/lib 加入 $PATH',
  },
  {
    section: 'time',
    key: 'useWindowsTimezone',
    type: 'boolean',
    label: '跟随 Windows 时区',
    hint: 'time.useWindowsTimezone — 使用并同步 Windows 设置的时区（默认 true）',
  },
] as const

/** 文本值 → 表单类型值；无法识别返回 undefined（视为未设置）。模块内实现，行为经 parseWslConf 观测 */
function coerceWslConfValue(
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
  // INI 段/键大小写不敏感：已知键比较必须归一，否则 Hostname 会被误列为“其他设置”
  const known = new Set(WSL_CONF_FIELDS.map((f) => `${f.section}.${f.key}`.toLowerCase()))
  const out: Array<{ section: string; key: string; value: string }> = []
  for (const l of parseIniLines(text)) {
    if (l.type !== 'entry' || !l.section || !l.key) continue
    if (known.has(`${l.section}.${l.key}`.toLowerCase())) continue
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
 * 行级 LCS 差异。配置文件体量小（wsl.conf ≤ 64KB），O(n·m) 常规足够；
 * 但极端输入（单字符行 ~3.2 万行）最坏可达 10^9 单元直接 OOM —
 * 超过 `DIFF_CELL_LIMIT` 退化为「全删 + 全增」（正确性不降，仅可读性降级 — review 0.1.2 根治）。
 */
const DIFF_CELL_LIMIT = 4_000_000
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split(/\r?\n/)
  const b = newText === '' ? [] : newText.split(/\r?\n/)
  const n = a.length
  const m = b.length
  if (n * m > DIFF_CELL_LIMIT) {
    return [
      ...a.map((text, i): DiffLine => ({ type: 'del', text, oldLine: i + 1 })),
      ...b.map((text, j): DiffLine => ({ type: 'add', text, newLine: j + 1 })),
    ]
  }
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

/**
 * 差异是否为空（保存前判断是否需要写盘）。
 * 行级等价（review 0.1.2 审计修复回归）：消费方依赖「仅换行风格差异不算 dirty」，
 * 先走 `a === b` 快速路径，否则按行分割逐行比较（O(n) 直接比较，不跑 LCS）。
 */
export function isSameText(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.split(/\r?\n/)
  const lb = b.split(/\r?\n/)
  if (la.length !== lb.length) return false
  for (let i = 0; i < la.length; i++) {
    if (la[i] !== lb[i]) return false
  }
  return true
}

/** 变更清单 → 展示文案（差异预览标题栏摘要；0.1.3 从主进程服务迁入共享层供渲染进程消费） */
export function summarizeWslConfChanges(changes: WslConfChange[]): string {
  if (changes.length === 0) return '无变更'
  const sets = changes.filter((c) => c.kind === 'set').length
  const removes = changes.filter((c) => c.kind === 'remove').length
  const parts: string[] = []
  if (sets > 0) parts.push(`${sets} 项修改`)
  if (removes > 0) parts.push(`${removes} 项删除`)
  return parts.join(' · ')
}
