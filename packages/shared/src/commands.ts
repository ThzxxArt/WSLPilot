/**
 * 备份 IO 纯助手 — 等价命令行构建（仅用于界面展示，绝不执行 — 设计书 §9.1）
 * 与备份文件命名 / 轮转匹配规范。主/渲染进程共享，保证命名一致。
 */
import type { BackupFormat, IoExportRequest, IoImportRequest, IoMoveRequest } from './types'

function quoteArg(s: string): string {
  return /[\s"'$`\\]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
}

/** 生成等价命令行字符串 */
export function formatCommand(program: string, args: string[]): string {
  return [program, ...args.map(quoteArg)].join(' ')
}

export function previewExportCommand(req: IoExportRequest): string {
  const args = ['--export', req.name, req.path]
  if (req.format === 'vhd') args.push('--vhd')
  return formatCommand('wsl.exe', args)
}

export function previewImportCommand(req: IoImportRequest): string {
  if (req.inPlace) {
    return formatCommand('wsl.exe', ['--import-in-place', req.name, req.archivePath])
  }
  const args = [
    '--import',
    req.name,
    req.installPath,
    req.archivePath,
    ...(req.format === 'vhd' ? ['--vhd'] : ['--version', req.version === 1 ? '1' : '2']),
  ]
  return formatCommand('wsl.exe', args)
}

export function previewMoveCommand(req: IoMoveRequest): string {
  return formatCommand('wsl.exe', ['--manage', req.name, '--move', req.path])
}

/** 备份文件扩展名（tar / vhd→vhdx） */
export function backupExtension(format: BackupFormat): string {
  return format === 'vhd' ? 'vhdx' : 'tar'
}

const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|]/g
// eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

function percentEncode(c: string): string {
  return `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
}

/**
 * 发行版名 → 文件名安全形态（唯一事实源）。
 * 非法字符用 `%XX` 转义而非统一替换为 `_`：`a*b` 与 `a_b` 才不会落到同一备份文件族，
 * 否则轮转会错删另一发行版的备份（review 数据安全根治）。
 * `%` 自身先转义（%25），保证映射无碰撞可往返。
 */
export function sanitizeNameForFile(name: string): string {
  return String(name ?? '')
    .replace(/%/g, '%25')
    .replace(CONTROL_CHARS, percentEncode)
    .replace(ILLEGAL_FILE_CHARS, percentEncode)
}

/** 备份文件命名：`<name>_<YYYYMMDD-HHmmss>.<ext>`（与轮转规则配套） */
export function exportFileName(name: string, format: BackupFormat, at: Date = new Date()): string {
  const safe = sanitizeNameForFile(name)
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  return `${safe}_${stamp}.${backupExtension(format)}`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 轮转匹配：`<sanitized(name)>_<8位日期-6位时间>.(tar|vhdx)` */
export function backupFileRegex(name: string): RegExp {
  return new RegExp(
    `^${escapeRegExp(sanitizeNameForFile(name))}_[0-9]{8}-[0-9]{6}\\.(tar|vhdx)$`,
    'i',
  )
}

/** 文件名是否符合备份命名规范 */
export function isBackupFileName(fileName: string): boolean {
  return /^[^\\/:*?"<>|]+_[0-9]{8}-[0-9]{6}\.(tar|vhdx)$/i.test(fileName)
}
