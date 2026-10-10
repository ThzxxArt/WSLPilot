/**
 * 诊断包（设计书 §15.3「导出诊断包」）— 脱敏纯函数。
 *
 * 诊断包内容：近期日志 + 配置脱敏副本 + 环境信息。
 * 「脱敏」的确定性规则（唯一事实源）：
 * 1. 用户主目录路径（`C:\Users\me` 及其 `/` 分隔形态、大小写变体）→ `%USERPROFILE%`
 * 2. URL 中的凭据 `scheme://user:pass@host` → `scheme://***@host`（代理地址常见）
 * 3. 形如密钥的赋值（`token=…` / `"password": "…"` 等）→ `***`
 * 其余内容原样保留——诊断包必须仍然可读、可定位问题。
 */

/** 诊断包清单（manifest.json） */
export interface DiagnosticsManifest {
  generatedAt: string
  app: {
    name: string
    version: string
    platform: string
    arch: string
    nodeVersion: string
    isWindows: boolean
  }
  wsl?: { wslVersion: string; kernelVersion: string; raw: string }
  logs: Array<{ name: string; sizeBytes: number }>
  configs: string[]
  note: string
}

export interface DiagnosticsExportResult {
  /** 生成的 zip 路径 */
  path: string
  /** 包内文件名清单 */
  entries: string[]
  sizeBytes: number
}

/** 诊断包固定说明（随 manifest 写入） */
export const DIAGNOSTICS_NOTE =
  'WSLPilot 诊断包：包含近期日志与配置脱敏副本（主目录已替换为 %USERPROFILE%、URL 凭据与密钥已打码），可安全提交给维护者排查问题。'

const URL_CREDENTIALS_RE = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi
const SECRET_ASSIGN_RE =
  /((?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key)["']?\s*[:=]\s*["']?)([^"'\s,;}]+)/gi

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 生成用户主目录的全部变体（Windows 大小写不敏感 + 分隔符变体 + JSON 转义形态）。
 * 只做确定性替换，不做模糊匹配，避免误伤非用户路径。
 */
export function homeDirVariants(homeDir: string): string[] {
  const raw = String(homeDir ?? '').trim()
  if (!raw) return []
  const slash = raw.replace(/\\/g, '/')
  const back = raw.replace(/\//g, '\\')
  const out = new Set<string>()
  for (const v of [raw, slash, back]) {
    if (!v) continue
    const normSlash = v.replace(/\\/g, '/')
    const normBack = v.replace(/\//g, '\\')
    for (const variant of [normSlash, normBack]) {
      out.add(variant)
      // JSONC 原文里路径的反斜杠是转义形态（`C:\\Users\\me`）
      out.add(variant.replace(/\\/g, '\\\\'))
    }
  }
  return [...out].filter(Boolean)
}

/**
 * 文本脱敏（诊断包写盘前逐文件调用）。
 * 主目录替换只在**路径边界**发生（后随分隔符或结尾）：
 * `C:\Users\me` 不会吃掉 `C:\Users\mee\x` 的前缀（review：前缀碰撞）。
 */
export function sanitizeDiagnosticsText(text: string, homeDir: string): string {
  let out = String(text ?? '')
  // 长变体先替换（防前缀吞掉更长路径）
  const variants = homeDirVariants(homeDir).sort((a, b) => b.length - a.length)
  for (const v of variants) {
    // (?![^\\/])：下一字符必须是路径分隔符或结尾
    out = out.replace(new RegExp(`${escapeRegExp(v)}(?![^\\\\/])`, 'gi'), '%USERPROFILE%')
  }
  out = out.replace(URL_CREDENTIALS_RE, '$1***@')
  out = out.replace(SECRET_ASSIGN_RE, '$1***')
  return out
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** 对象深脱敏（配置解析后的结构走这里；数组/嵌套对象递归） */
export function sanitizeDiagnosticsValue<T>(value: T, homeDir: string): T {
  if (typeof value === 'string') {
    return sanitizeDiagnosticsText(value, homeDir) as unknown as T
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeDiagnosticsValue(v, homeDir)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k)) continue
    out[k] = sanitizeDiagnosticsValue(v, homeDir)
  }
  return out as unknown as T
}

/** 诊断包文件名：`WSLPilot-diagnostics-YYYYMMDD-HHmmss.zip` */
export function diagnosticsFileName(at: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  return `WSLPilot-diagnostics-${stamp}.zip`
}
