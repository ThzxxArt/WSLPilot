/**
 * 诊断服务（M7，设计书 §15.3）：
 * - 「打开日志目录」：logs/ 目录（结构化 JSON 行日志，按天滚动）
 * - 「导出诊断包」：近期日志 + **配置脱敏副本** + 环境信息 → 一个 zip
 *
 * 脱敏规则唯一事实源：`@wslpilot/shared` 的 sanitizeDiagnosticsText/Value
 * （主目录 → %USERPROFILE%、URL 凭据、密钥赋值打码）。
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DIAGNOSTICS_NOTE,
  CONFIG_FILE_NAMES,
  createAppError,
  diagnosticsFileName,
  sanitizeDiagnosticsText,
  type ConfigKey,
  type DiagnosticsExportResult,
  type DiagnosticsManifest,
} from '@wslpilot/shared'
import { createZip, logsDir, type Logger, type ZipEntry } from '@wslpilot/kit'

/** 收录进诊断包的日志文件数上限（近期） */
export const DIAGNOSTICS_MAX_LOG_FILES = 10
/** 日志总体积上限（字节，超出只保留最新） */
export const DIAGNOSTICS_MAX_LOG_BYTES = 8 * 1024 * 1024

export interface DiagnosticsServiceDeps {
  logger: Logger
  userDataDir: string
  appVersion: string
  /** WSL 版本探测（失败可为空） */
  wslVersion?: () => Promise<{ wslVersion: string; kernelVersion: string; raw: string }>
  /** 用户主目录（脱敏替换目标；测试注入） */
  homeDir?: string
  /** 打开目录（注入 electron shell.openPath；仅允许目录） */
  openDirectory?: (path: string) => Promise<string>
  now?: () => Date
}

export interface DiagnosticsService {
  /** 日志目录绝对路径 */
  logsPath(): string
  /** 打开日志目录 */
  openLogsDir(): Promise<void>
  /** 生成诊断包并写入 targetPath */
  exportTo(targetPath: string): Promise<DiagnosticsExportResult>
  /** 默认文件名（保存对话框建议名） */
  defaultFileName(): string
}

/** 收集近期日志文件（按文件名倒序 = 时间倒序，限量限体积） */
export async function collectRecentLogs(
  dir: string,
  maxFiles = DIAGNOSTICS_MAX_LOG_FILES,
  maxBytes = DIAGNOSTICS_MAX_LOG_BYTES,
): Promise<Array<{ name: string; path: string; sizeBytes: number }>> {
  let names: string[]
  try {
    names = (await fs.readdir(dir))
      .filter((f) => /^app-.*\.log$/i.test(f))
      .sort()
      .reverse()
  } catch {
    return []
  }
  const out: Array<{ name: string; path: string; sizeBytes: number }> = []
  let total = 0
  for (const name of names) {
    if (out.length >= maxFiles) break
    const path = join(dir, name)
    let sizeBytes = 0
    try {
      sizeBytes = (await fs.stat(path)).size
    } catch {
      continue
    }
    if (total + sizeBytes > maxBytes && out.length > 0) break
    total += sizeBytes
    out.push({ name, path, sizeBytes })
  }
  return out
}

export function createDiagnosticsService(deps: DiagnosticsServiceDeps): DiagnosticsService {
  const logger = deps.logger
  const homeDir = deps.homeDir ?? homedir()
  const now = deps.now ?? (() => new Date())

  function logsPath(): string {
    return logsDir(deps.userDataDir)
  }

  function defaultFileName(): string {
    return diagnosticsFileName(now())
  }

  async function openLogsDir(): Promise<void> {
    const dir = logsPath()
    await fs.mkdir(dir, { recursive: true })
    const opener = deps.openDirectory
    if (!opener) return
    const err = await opener(dir)
    if (err) {
      logger.warn('open logs dir failed', { dir, err })
    }
  }

  async function exportTo(targetPath: string): Promise<DiagnosticsExportResult> {
    const entries: ZipEntry[] = []
    const logFiles = await collectRecentLogs(logsPath())
    const logSummaries: DiagnosticsManifest['logs'] = []

    for (const f of logFiles) {
      let text = ''
      try {
        text = await fs.readFile(f.path, 'utf8')
      } catch (e) {
        logger.warn('diagnostics: read log failed', { name: f.name, error: String(e) })
        continue
      }
      entries.push({ name: `logs/${f.name}`, content: sanitizeDiagnosticsText(text, homeDir) })
      logSummaries.push({ name: f.name, sizeBytes: f.sizeBytes })
    }

    // 配置脱敏副本：逐个读取 userData 目录下的 JSONC（损坏/缺失不阻断）
    const configNames: string[] = []
    for (const key of Object.keys(CONFIG_FILE_NAMES) as ConfigKey[]) {
      const name = CONFIG_FILE_NAMES[key]
      let text = ''
      try {
        text = await fs.readFile(join(deps.userDataDir, name), 'utf8')
      } catch {
        continue
      }
      entries.push({ name: `config/${name}`, content: sanitizeDiagnosticsText(text, homeDir) })
      configNames.push(name)
    }

    let wsl: DiagnosticsManifest['wsl']
    if (deps.wslVersion) {
      try {
        const v = await deps.wslVersion()
        wsl = { wslVersion: v.wslVersion, kernelVersion: v.kernelVersion, raw: v.raw }
      } catch (e) {
        logger.warn('diagnostics: wsl version failed', { error: String(e) })
      }
    }

    const manifest: DiagnosticsManifest = {
      generatedAt: now().toISOString(),
      app: {
        name: 'WSLPilot',
        version: deps.appVersion,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.versions.node,
        isWindows: process.platform === 'win32',
      },
      wsl,
      logs: logSummaries,
      configs: configNames,
      note: DIAGNOSTICS_NOTE,
    }
    entries.push({ name: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` })

    const zip = createZip(entries, now())
    await fs.writeFile(targetPath, zip)
    logger.info('diagnostics exported', {
      target: targetPath,
      entries: entries.length,
      bytes: zip.length,
    })
    return {
      path: targetPath,
      entries: entries.map((e) => e.name),
      sizeBytes: zip.length,
    }
  }

  return { logsPath, openLogsDir, exportTo, defaultFileName }
}

/** 供 handler 规范化目标路径：补 .zip 扩展名、拒绝空文件名（分隔符跨平台安全） */
export function normalizeDiagnosticsTarget(path: string): string {
  const p = String(path ?? '').trim()
  if (!p) {
    throw createAppError('IO_ERROR', { message: '保存路径不能为空' })
  }
  const withExt = /\.zip$/i.test(p) ? p : `${p}.zip`
  // Windows 路径在 POSIX 下 basename 不切 `\`，手工按双分隔符取文件名（跨平台一致）
  const base = withExt.split(/[\\/]/).pop() ?? ''
  if (base.toLowerCase() === '.zip') {
    throw createAppError('IO_ERROR', { message: '诊断包文件名不能为空' })
  }
  return withExt
}
