/**
 * WSL 3 容器（wslc）共享纯逻辑：校验、argv 构建、输出解析。
 *
 * 铁律：渲染层只传结构化字段，主进程用本模块构建 argv；绝不接受任意命令字符串。
 */
import { formatCommand } from './commands'
import { createAppError } from './errors'
import type {
  ContainerDetail,
  ContainerHealth,
  ContainerHealthSpec,
  ContainerMount,
  ContainerPort,
  ContainerRecipe,
  ContainerRunSpec,
  ContainerState,
  ContainerStats,
  ContainerSummary,
  WslcImage,
  WslcNetwork,
  WslcSessionInfo,
  WslcSettings,
  WslcSystemInfo,
  WslcVolume,
} from './types'

const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/
/** OCI image reference（宽松但拒绝空白/控制字符/命令行元字符）；digest 允许 @sha256: */
const IMAGE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/
const HOST_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/
const LINUX_PATH_RE = /^\/[^\0\r\n]*$/
// eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
const CONTROL_RE = /[\u0000-\u001f\u007f]/
// eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
const ARG_CONTROL_RE = /[\u0000-\u0008\u000a-\u001f\u007f]/
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV4_CIDR_RE = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
// Docker/WSL 时长语法允许复合值（1m30s / 500ms）
const DURATION_RE = /^(?:\d+(?:ms|s|m|h))+$/
const DURATION_ZERO_RE = /^0+(?:ms|s|m|h)$/

function isIpv4(s: string): boolean {
  return IPV4_RE.test(s) && s.split('.').every((x) => Number(x) >= 0 && Number(x) <= 255)
}

function bad(message: string, suggestion?: string): never {
  throw createAppError('INVALID_ARGUMENT', {
    message,
    suggestion: suggestion ?? '请检查容器参数后重试',
  })
}

export function assertContainerName(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!CONTAINER_NAME_RE.test(s)) {
    bad(
      `容器名非法：${String(value ?? '')}`,
      '容器名需以字母/数字开头，仅含字母、数字、下划线、点、连字符，长度 1–63',
    )
  }
  return s
}

/** 容器引用（短/全 ID 或名称）：ID 可达 64 位十六进制，不能按名称 63 位上限拒绝 */
export function assertContainerRef(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(s)) {
    bad(`容器 id 非法：${String(value ?? '')}`)
  }
  return s
}

export function assertImageRef(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s || s.length > 255 || !IMAGE_REF_RE.test(s) || CONTROL_RE.test(s)) {
    bad(`镜像引用非法：${String(value ?? '')}`, '请输入合法的 OCI 镜像引用，如 nginx:latest')
  }
  return s
}

export function assertLinuxContainerPath(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (
    !s ||
    s.length > 1024 ||
    !LINUX_PATH_RE.test(s) ||
    CONTROL_RE.test(s) ||
    s.split('/').some((p) => p === '..')
  ) {
    bad(`容器内路径非法：${String(value ?? '')}`, '容器内路径必须是绝对 Linux 路径且不能包含 ..')
  }
  return s
}

export function assertHostMountPath(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s || s.length > 1024 || CONTROL_RE.test(s) || !HOST_PATH_RE.test(s)) {
    bad(
      `主机挂载路径非法：${String(value ?? '')}`,
      '请选择绝对 Windows 路径（如 D:\\data 或 \\\\server\\share）',
    )
  }
  // 安全边界：拒绝挂载整个盘符根目录（计划 §6.8）
  if (/^[A-Za-z]:[\\/]?$/.test(s)) {
    bad(`不允许挂载磁盘根目录：${s}`, '请选择具体子目录，例如 D:\\projects\\app')
  }
  if (
    s
      .replace(/[\\/]+/g, '/')
      .split('/')
      .some((p) => p === '..')
  ) {
    bad(`主机挂载路径不允许 ..：${s}`)
  }
  return s.replace(/\\/g, '/')
}

export function assertPort(value: unknown): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) bad(`端口非法：${String(value)}`)
  return n
}

export function assertEnvKey(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) || s.length > 100) bad(`环境变量名非法：${s}`)
  return s
}

export function assertMemorySize(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!/^\d+(?:B|K|KB|M|MB|G|GB|T|TB)?$/.test(s)) {
    bad(`内存大小非法：${s}`, '使用整数 + B/K/KB/M/MB/G/GB/T/TB（如 512M、2GB）')
  }
  return s
}

/** 端口绑定地址（IPv4 / 主机名）：拒绝空白与控制字符，防止 argv 语义被破坏 */
export function assertPortAddress(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s || s.length > 255 || CONTROL_RE.test(s) || !/^[A-Za-z0-9_.:-]+$/.test(s)) {
    bad(`端口绑定地址非法：${String(value ?? '')}`, '请填写 IPv4 或主机名（如 127.0.0.1）')
  }
  return s
}

export function assertDuration(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!DURATION_RE.test(s) || DURATION_ZERO_RE.test(s)) {
    bad(`时间间隔非法：${s}`, '使用正整数 + ms/s/m/h（如 5s、1m30s、500ms）')
  }
  return s
}

/** 命令行参数：允许空格与普通文本，但拒绝 NUL 与除 Tab 外的 C0 控制字符（防日志/终端注入） */
export function assertArgValue(value: unknown): string {
  const s = typeof value === 'string' ? value : ''
  if (s.length > 8192 || s.includes('\u0000') || ARG_CONTROL_RE.test(s)) {
    bad('命令参数非法：包含控制字符或超过 8192 字符')
  }
  return s
}

/** 环境变量值：≤8KB UTF-8，拒绝 NUL / CR / LF（避免日志注入与 argv 语义歧义） */
export function assertEnvValue(value: unknown): string {
  const s = typeof value === 'string' ? value : String(value ?? '')
  // eslint-disable-next-line no-control-regex -- 有意拒绝 NUL / 换行
  if (new TextEncoder().encode(s).length > 8192 || /[\u0000\r\n]/.test(s)) {
    bad('环境变量值非法：超过 8KB 或包含换行/NUL')
  }
  return s
}

export function assertHealthSpec(h?: ContainerHealthSpec): ContainerHealthSpec | undefined {
  if (!h?.cmd?.trim()) return undefined
  const cmd = String(h.cmd).trim()
  if (cmd.length > 1024 || ARG_CONTROL_RE.test(cmd)) {
    bad('健康检查命令非法：超过 1024 字符或包含控制字符')
  }
  const out: ContainerHealthSpec = { cmd }
  if (h.interval !== undefined) out.interval = assertDuration(h.interval)
  if (h.timeout !== undefined) out.timeout = assertDuration(h.timeout)
  if (h.retries !== undefined) {
    const n = Number(h.retries)
    if (!Number.isInteger(n) || n < 0 || n > 100) bad(`健康检查重试次数非法：${h.retries}`)
    out.retries = n
  }
  if (h.startPeriod !== undefined) out.startPeriod = assertDuration(h.startPeriod)
  return out
}

export function assertNetworkOptions(opts: {
  driver?: string
  subnet?: string
  gateway?: string
}): { driver?: string; subnet?: string; gateway?: string } {
  const out: { driver?: string; subnet?: string; gateway?: string } = {}
  if (opts.driver !== undefined) {
    const d = opts.driver.trim()
    if (!/^[A-Za-z0-9_.-]{1,32}$/.test(d)) bad(`网络驱动非法：${opts.driver}`)
    out.driver = d
  }
  if (opts.subnet !== undefined) {
    const s = opts.subnet.trim()
    const [ip, prefixRaw] = s.split('/')
    if (!IPV4_CIDR_RE.test(s) || !isIpv4(ip ?? '')) {
      bad(`子网非法：${opts.subnet}`, '请使用 IPv4 CIDR，如 172.18.0.0/16')
    }
    const prefix = Number(prefixRaw)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      bad(`子网掩码非法：${opts.subnet}`)
    }
    out.subnet = s
  }
  if (opts.gateway !== undefined) {
    const g = opts.gateway.trim()
    if (!isIpv4(g)) bad(`网关非法：${opts.gateway}`, '请填写 IPv4 地址，如 172.18.0.1')
    out.gateway = g
  }
  return out
}

/**
 * `wslc container cp` 路径：宿主绝对路径，或 `<容器名>:<绝对 Linux 路径>`。
 * 拒绝以 `-` 开头的伪参数（argv 数组虽无 shell，但 CLI 会把 `--help` 当选项）。
 */
export function assertCopyPath(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s || s.length > 1024 || CONTROL_RE.test(s) || s.startsWith('-')) {
    bad(`复制路径非法：${String(value ?? '')}`)
  }
  const colon = s.indexOf(':')
  if (colon > 0) {
    const maybeContainer = s.slice(0, colon)
    const rest = s.slice(colon + 1)
    if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(maybeContainer) && rest.startsWith('/')) {
      assertContainerRef(maybeContainer)
      assertLinuxContainerPath(rest)
      return s
    }
  }
  if (s.startsWith('/')) {
    assertLinuxContainerPath(s)
    return s
  }
  return assertHostMountPath(s)
}

export function normalizeContainerState(raw: unknown): ContainerState {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'running' || s === 'up' || s.startsWith('up ')) return 'running'
  if (/^(运行中|运行|已启动|启动中)$/.test(s)) return 'running'
  if (s === 'exited' || s === 'stopped' || s.startsWith('exited ')) return 'exited'
  if (/^(已停止|停止|已退出|退出|已结束)$/.test(s)) return 'exited'
  if (s === 'created' || s.startsWith('created ')) return 'created'
  if (/^(已创建|创建|未启动)$/.test(s)) return 'created'
  if (s === 'paused' || s.startsWith('paused ')) return 'paused'
  if (/^(已暂停|暂停)$/.test(s)) return 'paused'
  if (s === 'dead' || s.startsWith('dead ')) return 'dead'
  if (/^(已死亡|死亡)$/.test(s)) return 'dead'
  if (s.startsWith('restarting')) return 'running'
  return 'unknown'
}

export function normalizeContainerHealth(raw: unknown): ContainerHealth {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'healthy') return 'healthy'
  if (s === 'unhealthy') return 'unhealthy'
  if (s === 'starting') return 'starting'
  if (s === 'none' || s === '') return 'none'
  return 'unknown'
}

/** 从 `8080:80` / `127.0.0.1:8080->80/tcp` / 对象解析端口 */
export function parsePorts(raw: unknown): ContainerPort[] {
  const out: ContainerPort[] = []
  const push = (host: unknown, container: unknown, address?: unknown) => {
    const h = Number(host)
    const c = Number(container)
    if (Number.isInteger(h) && h > 0 && h <= 65535 && Number.isInteger(c) && c > 0 && c <= 65535) {
      out.push({
        host: h,
        container: c,
        ...(typeof address === 'string' && address.trim() ? { address: address.trim() } : {}),
      })
    }
  }
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (p && typeof p === 'object') {
        const o = p as Record<string, unknown>
        push(
          o.hostPort ?? o.HostPort ?? o.host,
          o.containerPort ?? o.ContainerPort ?? o.container,
          o.hostIp ?? o.HostIp ?? o.address,
        )
      } else {
        parsePortString(String(p), push)
      }
    }
  } else if (typeof raw === 'string') {
    for (const part of raw.split(',')) parsePortString(part, push)
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    push(o.hostPort ?? o.host, o.containerPort ?? o.container, o.hostIp ?? o.address)
  }
  return out
}

function parsePortString(s: string, push: (h: unknown, c: unknown, a?: unknown) => void): void {
  const t = s.trim()
  if (!t) return
  // `127.0.0.1:8080->80/tcp` / `0.0.0.0:8080->80/tcp` / `8080->80/tcp`
  const arrow = /^(?:\[?([^\]]*?)\]?:)?(\d{1,5})->(\d{1,5})(?:\/\w+)?$/.exec(t)
  if (arrow) {
    push(arrow[2], arrow[3], arrow[1])
    return
  }
  // `8080:80`（wslc run 风格）
  const colon = /^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d{1,5}):(\d{1,5})$/.exec(t)
  if (colon) push(colon[2], colon[3], colon[1])
}

function pickString(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function pickNumber(o: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const n = Number(o[k])
    if (Number.isFinite(n)) return n
  }
  return 0
}

/** 从 `Up 2 hours (healthy)` / `Up 1s (health: starting)` 提取健康状态 */
function healthFromStatus(status: string): string {
  const m = /\((healthy|unhealthy|health:\s*starting)\)/i.exec(String(status ?? ''))
  if (!m) return ''
  const raw = m[1]!.toLowerCase()
  return raw.startsWith('health:') ? 'starting' : raw
}

export function parseContainerSummary(raw: unknown): ContainerSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const id = pickString(o, 'ID', 'Id', 'id', 'ContainerID', 'containerId')
  const namesRaw = o.Names ?? o.Name ?? o.name ?? o.names
  const name = Array.isArray(namesRaw)
    ? String(namesRaw[0] ?? '').replace(/^\//, '')
    : String(namesRaw ?? '').replace(/^\//, '')
  if (!id && !name) return null
  const statusText = pickString(o, 'Status', 'status', 'State', 'state')
  return {
    id: id || name,
    name: name || id.slice(0, 12),
    image: pickString(o, 'Image', 'image', 'ImageID', 'imageId'),
    state: normalizeContainerState(o.State ?? o.state ?? statusText),
    status: statusText,
    health: normalizeContainerHealth(o.Health ?? o.health ?? healthFromStatus(statusText)),
    ports: parsePorts(o.Ports ?? o.ports ?? o.Port),
    createdAt: pickString(o, 'CreatedAt', 'Created', 'created', 'createdAt'),
  }
}

/**
 * 解析 JSON 列表输出：优先整体 JSON（对象或数组），失败再按 NDJSON 逐行解析。
 * `wslc --format json` 在不同版本可能返回数组、对象包装或 NDJSON，三者都必须可用。
 */
export function parseJsonList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') {
    const text = String(raw ?? '').trim()
    if (!text) return []
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object') {
        const o = parsed as Record<string, unknown>
        for (const key of ['containers', 'items', 'data', 'networks', 'volumes', 'images']) {
          if (Array.isArray(o[key])) return o[key]
        }
      }
    } catch {
      /* NDJSON fallback */
    }
    return parseJsonLines(text)
  }
  const o = raw as Record<string, unknown>
  for (const key of ['containers', 'items', 'data', 'networks', 'volumes', 'images']) {
    if (Array.isArray(o[key])) return o[key]
  }
  return []
}

export function parseContainerList(raw: unknown): ContainerSummary[] {
  const rows = parseJsonList(raw)
  return rows.map(parseContainerSummary).filter((x): x is ContainerSummary => x !== null)
}

const HEADER_ALIASES = {
  id: ['CONTAINER ID', 'ID', '容器 ID', '容器ID'],
  image: ['IMAGE', '映像', '镜像'],
  status: ['STATUS', '状态'],
  ports: ['PORTS', '端口'],
  names: ['NAMES', 'NAME', '名称'],
} as const
const ALL_HEADERS = new Set<string>(Object.values(HEADER_ALIASES).flat())

function isHeaderCell(cell: string): boolean {
  const c = cell.trim().toUpperCase()
  if (ALL_HEADERS.has(c)) return true
  return /^(CPU|MEM|内存|操作|命令|已创建|CREATED|COMMAND)$/.test(c)
}

/** 表格回退：支持 Docker / wslc 中英文、有无 CREATED 列的形态 */
export function parseContainerTable(raw: string): ContainerSummary[] {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (lines.length === 0) return []
  const headerCols = lines[0]!
    .toUpperCase()
    .split(/\s{2,}/)
    .map((c) => c.trim())
  const hasHeader = headerCols.some(isHeaderCell)
  const col = (names: readonly string[]): number =>
    headerCols.findIndex((c) => (names as readonly string[]).includes(c))
  const idx = {
    id: hasHeader ? col(HEADER_ALIASES.id) : 0,
    image: hasHeader ? col(HEADER_ALIASES.image) : 1,
    status: hasHeader ? col(HEADER_ALIASES.status) : -1,
    ports: hasHeader ? col(HEADER_ALIASES.ports) : -1,
    names: hasHeader ? col(HEADER_ALIASES.names) : -1,
  }
  const out: ContainerSummary[] = []
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const parts = line.trim().split(/\s{2,}/)
    if (parts.length < 2) continue
    if (parts.some((p) => isHeaderCell(p))) continue
    const pick = (i: number): string => (i >= 0 ? (parts[i] ?? '') : '')
    const status =
      idx.status >= 0
        ? pick(idx.status)
        : (parts.find((p) => /^(Up|Exited|Created|Paused|Dead|运行中|已停止|已退出)\b/i.test(p)) ??
          '')
    const name = idx.names >= 0 ? pick(idx.names) : (parts.at(-1) ?? '')
    const id = pick(idx.id)
    if (!id && !name) continue
    out.push({
      id: id || name,
      name: name.replace(/^\//, '') || id.slice(0, 12),
      image: idx.image >= 0 ? pick(idx.image) : (parts[1] ?? ''),
      state: normalizeContainerState(status),
      status,
      // 表格输出没有健康字段时从 STATUS 文本推断（Up 2h (healthy)）
      health: normalizeContainerHealth(healthFromStatus(status)),
      ports: parsePorts(idx.ports >= 0 ? pick(idx.ports) : ''),
      createdAt: '',
    })
  }
  return out
}

export function parseContainerDetail(raw: unknown): ContainerDetail | null {
  const base = parseContainerSummary(raw)
  if (!base) return null
  const o = (raw ?? {}) as Record<string, unknown>
  const env: Record<string, string> = {}
  const envRaw = o.Env ?? o.env ?? o.Config
  const list = Array.isArray(envRaw)
    ? envRaw
    : envRaw && typeof envRaw === 'object'
      ? (((envRaw as Record<string, unknown>).Env as unknown[]) ?? [])
      : []
  for (const item of list) {
    const s = String(item ?? '')
    const eq = s.indexOf('=')
    if (eq > 0) env[s.slice(0, eq)] = s.slice(eq + 1)
  }
  return {
    ...base,
    command: Array.isArray(o.Command) ? o.Command.map(String) : undefined,
    env,
    mounts: Array.isArray(o.Mounts)
      ? (o.Mounts as unknown[]).flatMap((m) => {
          if (!m || typeof m !== 'object') return []
          const x = m as Record<string, unknown>
          const host = String(x.Source ?? x.host ?? '')
          const container = String(x.Destination ?? x.container ?? '')
          return host && container ? [{ host, container, readOnly: x.RW === false }] : []
        })
      : undefined,
    networks: Array.isArray(o.Networks)
      ? o.Networks.map((n) =>
          String(
            (n as { Name?: string; name?: string })?.Name ?? (n as { name?: string })?.name ?? n,
          ),
        )
      : o.Networks && typeof o.Networks === 'object'
        ? Object.keys(o.Networks as Record<string, unknown>)
        : undefined,
    raw,
  }
}

function parseHumanBytes(value: unknown): number {
  if (typeof value === 'number') return value
  const m = /^([\d.]+)\s*([KMGTPE]?(?:i?B)?)$/i.exec(String(value ?? '').trim())
  if (!m) return 0
  const n = Number(m[1])
  const unit = (m[2] ?? 'B').toUpperCase()
  const mult: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
  }
  return Number.isFinite(n) ? Math.round(n * (mult[unit] ?? 1)) : 0
}

export function parseImageList(raw: unknown): WslcImage[] {
  const rows = parseJsonList(raw)
  if (rows.length === 0 && typeof raw === 'string') {
    const out: WslcImage[] = []
    for (const line of raw.split(/\r?\n/).slice(1)) {
      const parts = line.trim().split(/\s{2,}/)
      if (parts.length < 3) continue
      const [repository, tag, id, created, size] = parts
      out.push({
        id: id ?? repository ?? '',
        repository: repository ?? '',
        tag: tag || 'latest',
        sizeBytes: parseHumanBytes(size),
        createdAt: created ?? '',
        containers: 0,
      })
    }
    if (out.length > 0) return out
  }
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const o = row as Record<string, unknown>
    const repo = pickString(o, 'Repository', 'repository', 'Name', 'name')
    const tag = pickString(o, 'Tag', 'tag') || 'latest'
    const id = pickString(o, 'ID', 'Id', 'id', 'ImageID')
    if (!id && !repo) return []
    return [
      {
        id: id || repo,
        repository: repo,
        tag,
        sizeBytes: parseHumanBytes(o.Size ?? o.size ?? o.SizeBytes),
        createdAt: pickString(o, 'CreatedAt', 'Created', 'created', 'createdAt'),
        containers: pickNumber(o, 'Containers', 'containers'),
      },
    ]
  })
}

export function parseStats(raw: unknown): ContainerStats[] {
  const rows = parseJsonList(raw)
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const o = row as Record<string, unknown>
    const containerId = pickString(o, 'Container', 'container', 'ID', 'id')
    if (!containerId) return []
    const parseBytes = (v: unknown): number => {
      if (typeof v === 'number') return v
      const s = String(v ?? '')
        .trim()
        .split('/')[0]!
        .trim()
      const m = /^([\d.]+)\s*([KMGTPE]?(?:i?B)?)$/i.exec(s)
      if (!m) return 0
      const n = Number(m[1])
      const unit = (m[2] ?? '').toUpperCase()
      const mult: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1024 ** 2,
        GB: 1024 ** 3,
        TB: 1024 ** 4,
        KIB: 1024,
        MIB: 1024 ** 2,
        GIB: 1024 ** 3,
        TIB: 1024 ** 4,
        K: 1024,
        M: 1024 ** 2,
        G: 1024 ** 3,
        T: 1024 ** 4,
      }
      return Number.isFinite(n) ? Math.round(n * (mult[unit] ?? 1)) : 0
    }
    const cpuRaw = String(o.CPU ?? o.Cpu ?? o.cpu ?? o.CPUPerc ?? o.CpuPerc ?? '0').replace('%', '')
    const memUsageRaw = String(o.MemUsage ?? o.memUsage ?? o.MemUsed ?? '')
    const memParts = memUsageRaw.split('/')
    return [
      {
        containerId,
        name: pickString(o, 'Name', 'name'),
        cpuPercent: Number(cpuRaw) || 0,
        memUsedBytes: parseBytes(memParts[0] ?? ''),
        memLimitBytes: parseBytes(o.MemLimit ?? o.memLimit ?? memParts[1] ?? ''),
        netRxBytes: parseBytes(o.NetIO ?? o.netIO ?? o.NetRx),
        netTxBytes: parseBytes(o.NetTx ?? o.netTx),
        blockReadBytes: parseBytes(o.BlockIO ?? o.blockIO ?? o.BlockRead),
        blockWriteBytes: parseBytes(o.BlockWrite ?? o.blockWrite),
        pids: pickNumber(o, 'PIDs', 'Pids', 'pids'),
        sampledAt: pickString(o, 'SampledAt', 'sampledAt') || new Date().toISOString(),
      },
    ]
  })
}

export function parseNetworks(raw: unknown): WslcNetwork[] {
  const rows = parseJsonList(raw)
  if (rows.length === 0 && typeof raw === 'string') {
    const out: WslcNetwork[] = []
    for (const line of raw.split(/\r?\n/).slice(1)) {
      const parts = line.trim().split(/\s{2,}/)
      if (parts.length < 2) continue
      out.push({
        id: parts[0] ?? '',
        name: parts[1] ?? parts[0] ?? '',
        driver: parts[2] ?? 'bridge',
        subnet: undefined,
        gateway: undefined,
        internal: false,
        containers: [],
      })
    }
    if (out.length > 0) return out
  }
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const o = row as Record<string, unknown>
    const name = pickString(o, 'Name', 'name')
    if (!name) return []
    return [
      {
        id: pickString(o, 'ID', 'Id', 'id') || name,
        name,
        driver: pickString(o, 'Driver', 'driver') || 'bridge',
        subnet: pickString(o, 'Subnet', 'subnet') || undefined,
        gateway: pickString(o, 'Gateway', 'gateway') || undefined,
        internal:
          o.Internal === true ||
          o.internal === true ||
          String(o.Internal ?? o.internal ?? '').toLowerCase() === 'true',
        containers: Array.isArray(o.Containers)
          ? o.Containers.map((c) =>
              c && typeof c === 'object'
                ? String(
                    (c as { Name?: string; name?: string }).Name ??
                      (c as { name?: string }).name ??
                      '',
                  )
                : String(c),
            )
          : o.Containers && typeof o.Containers === 'object'
            ? Object.keys(o.Containers as Record<string, unknown>)
            : [],
      },
    ]
  })
}

export function parseVolumes(raw: unknown): WslcVolume[] {
  const rows = parseJsonList(raw)
  if (rows.length === 0 && typeof raw === 'string') {
    const out: WslcVolume[] = []
    for (const line of raw.split(/\r?\n/).slice(1)) {
      const parts = line.trim().split(/\s{2,}/)
      if (parts.length === 0) continue
      out.push({
        name: parts.at(-1) ?? '',
        driver: parts[0] ?? 'local',
        mountpoint: undefined,
        createdAt: undefined,
      })
    }
    if (out.length > 0) return out
  }
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const o = row as Record<string, unknown>
    const name = pickString(o, 'Name', 'name')
    if (!name) return []
    return [
      {
        name,
        driver: pickString(o, 'Driver', 'driver') || 'local',
        mountpoint: pickString(o, 'Mountpoint', 'mountpoint') || undefined,
        createdAt: pickString(o, 'CreatedAt', 'createdAt') || undefined,
      },
    ]
  })
}

export function parseSessionList(raw: unknown): WslcSessionInfo[] {
  const rows = parseJsonList(raw)
  if (rows.length === 0 && typeof raw === 'string') {
    const out: WslcSessionInfo[] = []
    for (const line of raw.split(/\r?\n/).slice(1)) {
      const parts = line.trim().split(/\s{2,}/)
      if (parts.length === 0 || !parts[0]) continue
      const name = parts.at(-1)?.trim() || parts[0]!
      const second = parts[1] ?? ''
      out.push({
        // `system session list` 列：ID / 创建者 PID / 显示名称
        name,
        state: /^[A-Za-z]+$/.test(second) ? second : 'running',
        storagePath: undefined,
        cpuCount: undefined,
        memorySize: undefined,
        idleTimeoutSec: undefined,
      })
    }
    if (out.length > 0) return out
  }
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const o = row as Record<string, unknown>
    const name = pickString(o, 'Name', 'name', 'Session', 'session')
    if (!name) return []
    return [
      {
        name,
        state: pickString(o, 'State', 'state', 'Status', 'status') || 'unknown',
        storagePath: pickString(o, 'StoragePath', 'storagePath') || undefined,
        cpuCount: pickNumber(o, 'CpuCount', 'cpuCount') || undefined,
        memorySize: pickString(o, 'MemorySize', 'memorySize') || undefined,
        idleTimeoutSec: pickNumber(o, 'IdleTimeout', 'idleTimeout') || undefined,
      },
    ]
  })
}

export function parseSystemInfo(raw: unknown): WslcSystemInfo {
  if (typeof raw === 'string') {
    raw = parseJsonList(raw)[0] ?? raw
  }
  if (!raw || typeof raw !== 'object') {
    return { version: '', raw: String(raw ?? '') }
  }
  const o = raw as Record<string, unknown>
  const client = (o.Client && typeof o.Client === 'object' ? o.Client : {}) as Record<
    string,
    unknown
  >
  const server = (o.Server && typeof o.Server === 'object' ? o.Server : {}) as Record<
    string,
    unknown
  >
  return {
    version: pickString(client, 'Version', 'version') || pickString(o, 'Version', 'version'),
    storagePath:
      pickString(server, 'StoragePath', 'storagePath') ||
      pickString(o, 'StoragePath', 'storagePath') ||
      undefined,
    storageBytes:
      pickNumber(server, 'StorageBytes', 'storageBytes') ||
      pickNumber(o, 'StorageBytes', 'storageBytes') ||
      undefined,
    settingsPath: pickString(client, 'SettingsFile', 'settingsFile') || undefined,
    raw: JSON.stringify(raw),
  }
}

/** `wslc system info --format json` 的 Server.Sessions → 会话列表（唯一解析入口） */
export function parseSystemInfoSessions(raw: unknown): WslcSessionInfo[] {
  const value = parseJsonList(raw)[0]
  const o = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const server = (o.Server && typeof o.Server === 'object' ? o.Server : {}) as Record<
    string,
    unknown
  >
  const list = Array.isArray(server.Sessions) ? server.Sessions : []
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const s = item as Record<string, unknown>
    const name = pickString(s, 'Name', 'name', 'DisplayName') || String(s.ID ?? '')
    if (!name) return []
    return [
      {
        name,
        state: pickString(s, 'State', 'state', 'Status', 'status') || 'running',
        storagePath: pickString(s, 'StoragePath', 'storagePath') || undefined,
        cpuCount: pickNumber(s, 'CpuCount', 'cpuCount') || undefined,
        memorySize: pickString(s, 'MemorySize', 'memorySize') || undefined,
        idleTimeoutSec: pickNumber(s, 'IdleTimeout', 'idleTimeout') || undefined,
      },
    ]
  })
}

/** NDJSON：一行一个对象；忽略空行与非对象行 */
export function parseJsonLines(raw: string): unknown[] {
  const out: unknown[] = []
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const v = JSON.parse(t)
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(v)
    } catch {
      /* 非 JSON 行忽略 */
    }
  }
  return out
}

export function buildContainerRunArgs(spec: ContainerRunSpec): string[] {
  const image = assertImageRef(spec.image)
  const args = ['run']
  if (spec.detach !== false) args.push('-d')
  if (spec.rm) args.push('--rm')
  if (spec.name) args.push('--name', assertContainerName(spec.name))
  const seenHostPorts = new Set<string>()
  for (const p of spec.ports) {
    const port = assertPort(p.container)
    const host = assertPort(p.host)
    const addr = p.address?.trim()
    const key = `${addr ?? ''}:${host}`
    if (seenHostPorts.has(key)) bad(`宿主端口重复绑定：${host}`)
    seenHostPorts.add(key)
    args.push('-p', addr ? `${assertPortAddress(addr)}:${host}:${port}` : `${host}:${port}`)
  }
  for (const m of spec.mounts) {
    args.push(
      '-v',
      `${assertHostMountPath(m.host)}:${assertLinuxContainerPath(m.container)}${m.readOnly ? ':ro' : ''}`,
    )
  }
  for (const [k, v] of Object.entries(spec.env)) {
    args.push('-e', `${assertEnvKey(k)}=${assertEnvValue(v)}`)
  }
  if (spec.network) {
    const network = assertContainerName(spec.network)
    // 安全边界：不暴露 host 网络（与 --privileged/--device 同级隔离风险）
    if (network.toLowerCase() === 'host') bad('不允许使用 host 网络，请选择 bridge 或自定义网络')
    args.push('--network', network)
  }
  if (spec.memory) args.push('-m', assertMemorySize(spec.memory))
  if (spec.cpus !== undefined) {
    const n = Number(spec.cpus)
    if (!Number.isFinite(n) || n <= 0 || n > 1024) bad(`CPU 数量非法：${spec.cpus}`)
    args.push('--cpus', String(n))
  }
  if (spec.gpus === 'all') args.push('--gpus', 'all')
  const health = assertHealthSpec(spec.health)
  if (health) {
    args.push('--health-cmd', health.cmd)
    if (health.interval) args.push('--health-interval', health.interval)
    if (health.timeout) args.push('--health-timeout', health.timeout)
    if (health.retries !== undefined) args.push('--health-retries', String(health.retries))
    if (health.startPeriod) args.push('--health-start-period', health.startPeriod)
  }
  if (spec.stopTimeoutSec !== undefined) {
    const n = Number(spec.stopTimeoutSec)
    if (!Number.isInteger(n) || n < 1 || n > 300) bad(`停止超时非法：${spec.stopTimeoutSec}`)
    args.push('--stop-timeout', String(n))
  }
  args.push(image)
  if (spec.command?.length) {
    if (spec.command.length > 200) bad('命令参数过多（>200）')
    args.push(...spec.command.map((c) => assertArgValue(c)))
  }
  return args
}

export function buildContainerStartArgs(id: string): string[] {
  return ['start', assertContainerRef(id)]
}
export function buildContainerStopArgs(id: string, timeoutSec?: number): string[] {
  const args = ['stop']
  if (timeoutSec !== undefined) {
    const n = Number(timeoutSec)
    if (!Number.isInteger(n) || n < 1 || n > 300) bad(`停止超时非法：${timeoutSec}`)
    args.push('-t', String(n))
  }
  args.push(assertContainerRef(id))
  return args
}
export function buildContainerRestartArgs(id: string): string[] {
  return ['container', 'restart', assertContainerRef(id)]
}
export function buildContainerRemoveArgs(id: string, force = false): string[] {
  return ['container', 'remove', ...(force ? ['-f'] : []), assertContainerRef(id)]
}
export function buildContainerPruneArgs(): string[] {
  return ['container', 'prune']
}
export function buildContainerLogsArgs(id: string, follow = false, tail = 500): string[] {
  return [
    'container',
    'logs',
    ...(follow ? ['-f'] : []),
    '--tail',
    String(Math.max(1, Math.min(5000, Math.floor(tail)))),
    assertContainerRef(id),
  ]
}
export function buildContainerCopyArgs(src: string, dst: string): string[] {
  return ['container', 'cp', assertCopyPath(src), assertCopyPath(dst)]
}
export function buildImagePullArgs(ref: string): string[] {
  return ['pull', assertImageRef(ref)]
}
export function buildImageBuildArgs(tag: string, context: string): string[] {
  return ['build', '-t', assertImageRef(tag), assertHostMountPath(context)]
}
export function buildImageRemoveArgs(ref: string): string[] {
  return ['image', 'remove', assertImageRef(ref)]
}
export function buildImagePruneArgs(all = false): string[] {
  return ['image', 'prune', ...(all ? ['--all'] : [])]
}
export function buildNetworkCreateArgs(
  name: string,
  opts: { driver?: string; subnet?: string; gateway?: string } = {},
): string[] {
  const safe = assertNetworkOptions(opts)
  const args = ['network', 'create']
  if (safe.driver) args.push('-d', safe.driver)
  if (safe.subnet) args.push('--subnet', safe.subnet)
  if (safe.gateway) args.push('--gateway', safe.gateway)
  args.push(assertContainerName(name))
  return args
}
export function buildNetworkRemoveArgs(name: string): string[] {
  return ['network', 'remove', assertContainerName(name)]
}
export function buildNetworkConnectArgs(network: string, container: string): string[] {
  return ['network', 'connect', assertContainerName(network), assertContainerRef(container)]
}
export function buildNetworkDisconnectArgs(network: string, container: string): string[] {
  return ['network', 'disconnect', assertContainerName(network), assertContainerRef(container)]
}
export function buildNetworkListArgs(json = true): string[] {
  return ['network', 'list', ...(json ? ['--format', 'json'] : [])]
}
export function buildVolumeListArgs(json = true): string[] {
  return ['volume', 'list', ...(json ? ['--format', 'json'] : [])]
}
export function buildVolumeCreateArgs(name: string): string[] {
  return ['volume', 'create', assertContainerName(name)]
}
export function buildVolumeRemoveArgs(name: string): string[] {
  return ['volume', 'remove', assertContainerName(name)]
}
export function buildVolumePruneArgs(): string[] {
  return ['volume', 'prune']
}
export function buildNetworkPruneArgs(): string[] {
  return ['network', 'prune']
}
export function buildSessionTerminateArgs(): string[] {
  return ['system', 'session', 'terminate']
}
export function buildSystemInfoArgs(json = true): string[] {
  return ['system', 'info', ...(json ? ['--format', 'json'] : [])]
}
export function buildSessionListArgs(json = true): string[] {
  return ['system', 'session', 'list', ...(json ? ['--format', 'json'] : [])]
}
export function buildContainerListArgs(all = true, json = true): string[] {
  return ['container', 'list', ...(all ? ['--all'] : []), ...(json ? ['--format', 'json'] : [])]
}
export function buildImageListArgs(json = true): string[] {
  return ['image', 'list', ...(json ? ['--format', 'json'] : [])]
}
export function buildStatsArgs(all = true, json = true): string[] {
  return ['stats', ...(all ? ['-a'] : []), ...(json ? ['--format', 'json'] : [])]
}
export function buildEventsArgs(): string[] {
  return ['events']
}

/**
 * 等价命令预览（含日志/错误 rawCommand）。
 * 默认脱敏 `-e KEY=VALUE` / `--env KEY=VALUE` 的值：环境变量常含密钥，
 * 不能被任务日志或错误详情原样落盘（plan §6.8）。
 */
export function previewWslcCommand(args: string[], opts: { redactSecrets?: boolean } = {}): string {
  const redact = opts.redactSecrets !== false
  const safe = args.map((arg, i) => {
    if (!redact) return arg
    const prev = args[i - 1]
    if ((prev === '-e' || prev === '--env') && arg.includes('=')) {
      const eq = arg.indexOf('=')
      return `${arg.slice(0, eq)}=***`
    }
    return arg
  })
  return formatCommand('wslc.exe', safe)
}

/** 配方 → 运行 spec（唯一事实源） */
export function recipeToRunSpec(recipe: ContainerRecipe): ContainerRunSpec {
  return {
    image: recipe.image,
    name: recipe.name,
    command: recipe.command,
    ports: recipe.ports,
    mounts: recipe.mounts,
    env: recipe.env,
    network: recipe.network,
    detach: recipe.detach,
    rm: recipe.rm,
    stopTimeoutSec: recipe.stopTimeoutSec,
    health: recipe.health,
  }
}

/** 默认 wslc 设置（settings.yaml 表单模型） */
export function emptyWslcSettings(): WslcSettings {
  return { session: {} }
}

export function defaultContainerRecipe(id = 'recipe'): ContainerRecipe {
  return {
    id,
    label: '新容器配方',
    image: 'ubuntu:latest',
    ports: [],
    mounts: [],
    env: {},
    detach: true,
    rm: false,
  }
}

export function normalizeHealthSpec(h?: ContainerHealthSpec): ContainerHealthSpec | undefined {
  if (!h?.cmd?.trim()) return undefined
  return {
    cmd: h.cmd.trim(),
    ...(h.interval ? { interval: h.interval } : {}),
    ...(h.timeout ? { timeout: h.timeout } : {}),
    ...(h.retries !== undefined ? { retries: h.retries } : {}),
    ...(h.startPeriod ? { startPeriod: h.startPeriod } : {}),
  }
}

export function assertMount(m: ContainerMount): ContainerMount {
  return {
    host: assertHostMountPath(m.host),
    container: assertLinuxContainerPath(m.container),
    readOnly: m.readOnly === true,
  }
}
