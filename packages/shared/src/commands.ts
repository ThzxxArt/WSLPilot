/**
 * 备份 IO 纯助手 — 等价命令行构建（仅用于界面展示，绝不执行 — 设计书 §9.1）
 * 与备份文件命名 / 轮转匹配规范。主/渲染进程共享，保证命名一致。
 */
import type { BackupFormat, IoExportRequest, IoImportRequest, IoMoveRequest } from './types'

/**
 * 等价命令参数引用（用于「复制到管理员终端执行」场景的展示文本）。
 *
 * 采用 **PowerShell 单引号规则**：无需引用时原样；否则 `'…'` 包裹、内部 `'` 双写。
 * - 此前只处理空白/引号/`$`/反引号/反斜杠并统一双引号：`&` `%` `|` `^` `<` `>` `(`
 *   等 cmd 元字符未被处理，复制到终端会注入/错误展开（review 0.1.2 根治）。
 * - PowerShell 单引号内一切字符（含 cmd 元字符）均为字面量，复制执行零歧义；
 *   引用统一引导「管理员 PowerShell」（README 故障排查 / 错误建议文案同步）。
 */
function quoteArg(s: string): string {
  if (s === '') return "''"
  return /[^\w.\-:/\\@+=~]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s
}

/** 生成等价命令行字符串 */
export function formatCommand(program: string, args: string[]): string {
  return [program, ...args.map(quoteArg)].join(' ')
}

/**
 * 备份目标文件名归一（唯一事实源）：trim + 扩展名归一。
 * - vhd：`.vhd`/`.tar` 错配改写为 `.vhdx`，缺失扩展名补齐 `.vhdx`
 * - tar：`.vhdx`/`.vhd` 错配改写为 `.tar`，缺失扩展名补齐 `.tar`
 * 纯字符串操作（主/渲染共享，不引 node API）；
 * 环境变量展开与绝对化**不**在此发生（执行侧 io-service 负责）。
 * 幂等：对已归一结果再调用无副作用。
 */
export function normalizeBackupTarget(input: string, format: BackupFormat): string {
  const p = String(input ?? '').trim()
  const want = format === 'vhd' ? '.vhdx' : '.tar'
  const lower = p.toLowerCase()
  if (format === 'vhd') {
    if (lower.endsWith('.tar') || lower.endsWith('.vhd')) {
      return `${p.replace(/\.(tar|vhd)$/i, '')}${want}`
    }
    return lower.endsWith('.vhdx') ? p : `${p}${want}`
  }
  if (lower.endsWith('.vhdx') || lower.endsWith('.vhd')) {
    return p.replace(/\.(vhdx|vhd)$/i, want)
  }
  return lower.endsWith('.tar') ? p : `${p}${want}`
}

/**
 * `wsl --export` argv（唯一事实源：preview 与实跑 io-service 共用）。
 * 目标路径经 `normalizeBackupTarget` 做扩展名归一；
 * 环境变量展开与绝对化发生在执行侧（io-service resolveTargetFile）。
 */
export function buildExportArgs(name: string, path: string, format: BackupFormat): string[] {
  return [
    '--export',
    name,
    normalizeBackupTarget(path, format),
    ...(format === 'vhd' ? ['--vhd'] : []),
  ]
}

/**
 * `wsl --import` / `--import-in-place` argv（唯一事实源：preview 与实跑 io-service 共用）。
 * 归档 / 安装位置是既有文件与目录，不做扩展名归一（执行侧只做环境变量展开与绝对化）。
 */
export function buildImportArgs(req: IoImportRequest): string[] {
  const format: BackupFormat = req.format === 'vhd' ? 'vhd' : 'tar'
  if (req.inPlace) return ['--import-in-place', req.name, req.archivePath]
  return [
    '--import',
    req.name,
    req.installPath,
    req.archivePath,
    ...(format === 'vhd' ? ['--vhd'] : ['--version', req.version === 1 ? '1' : '2']),
  ]
}

/**
 * `wsl --manage --move` argv（唯一事实源：preview / 实跑 io-service / 提权 elevation 共用）。
 * 迁移目标是目录，不做扩展名归一（执行侧只做环境变量展开与绝对化）。
 */
export function buildMoveArgs(name: string, path: string): string[] {
  return ['--manage', name, '--move', path]
}

/**
 * `wsl --manage <name> --set-sparse <true|false>` argv（0.1.3 磁盘管理）。
 * 唯一事实源：WslService 实跑与提权 elevation 共用（需 WSL 2.0+）。
 */
export function buildSetSparseArgs(name: string, sparse: boolean): string[] {
  return ['--manage', name, '--set-sparse', sparse ? 'true' : 'false']
}

/**
 * `wsl --update [--pre-release]` argv（0.1.3 WSL 本体更新）。
 * 唯一事实源：WslService 实跑与提权 elevation 共用。
 */
export function buildUpdateArgs(preRelease = false): string[] {
  return ['--update', ...(preRelease ? ['--pre-release'] : [])]
}

/** `wsl --update --rollback` argv（0.1.3 回滚最近一次更新；唯一事实源） */
export function buildUpdateRollbackArgs(): string[] {
  return ['--update', '--rollback']
}

/** `wsl --set-default-version <1|2>` argv（0.1.3；唯一事实源） */
export function buildSetDefaultVersionArgs(version: 1 | 2): string[] {
  return ['--set-default-version', version === 1 ? '1' : '2']
}

/**
 * 等价命令行预览（仅展示，绝不执行 — 设计书 §9.1）。
 * 与实跑同源（build*Args）：导出目标路径做扩展名归一（`.vhd` → `.vhdx`、补扩展名）；
 * 环境变量展开与绝对化发生在执行侧（renderer 无 process.env），故预览保留用户书写的路径主体。
 */
export function previewExportCommand(req: IoExportRequest): string {
  return formatCommand('wsl.exe', buildExportArgs(req.name, req.path, req.format))
}

/** @see previewExportCommand — 与实跑同源（build*Args） */
export function previewImportCommand(req: IoImportRequest): string {
  return formatCommand('wsl.exe', buildImportArgs(req))
}

/** @see previewExportCommand — 与实跑同源（build*Args） */
export function previewMoveCommand(req: IoMoveRequest): string {
  return formatCommand('wsl.exe', buildMoveArgs(req.name, req.path))
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

/**
 * 规范备份名「时间戳 + 扩展名」尾段（命名规范唯一事实源）：
 * `<name>_<YYYYMMDD-HHmmss>.(tar|vhdx)`
 * isBackupFileName / backupFileGroup / backupFileRegex 全部由它派生，杜绝第四份拷贝。
 */
const BACKUP_STAMP_SUFFIX = '_[0-9]{8}-[0-9]{6}\\.(?:tar|vhdx)$'
/** 规范备份名全文匹配（name 头不含 \\ / : * ? " < > |） */
const BACKUP_FILE_RE = new RegExp(`^([^\\\\/:*?"<>|]+)${BACKUP_STAMP_SUFFIX}`, 'i')

/** 轮转匹配：`<sanitized(name)>` + 规范备份名尾段（与命名规范同源） */
export function backupFileRegex(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(sanitizeNameForFile(name))}${BACKUP_STAMP_SUFFIX}`, 'i')
}

/** 文件名是否符合备份命名规范（唯一事实源 BACKUP_STAMP_SUFFIX） */
export function isBackupFileName(fileName: string): boolean {
  return BACKUP_FILE_RE.test(fileName)
}

/** 文件名 → 备份族名字头（规范化 name）；不符合命名规范返回 null（非规范文件不算备份） */
export function backupFileGroup(fileName: string): string | null {
  return BACKUP_FILE_RE.exec(fileName)?.[1] ?? null
}
