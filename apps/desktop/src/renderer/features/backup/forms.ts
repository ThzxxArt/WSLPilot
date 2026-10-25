/**
 * 备份迁移向导表单纯逻辑（步骤校验 / 请求构建 / 摘要行 / 命令预览）。
 * 无副作用，供 ExportWizard / ImportWizard / MoveWizard 与 BackupView 共用。
 */
import type {
  BackupFormat,
  IoExportRequest,
  IoImportRequest,
  IoMoveRequest,
} from '@wslpilot/shared'
import {
  assertSafeDistroName,
  exportFileName,
  previewExportCommand,
  previewImportCommand,
  previewMoveCommand,
} from '@wslpilot/shared'

export type WizardMode = 'export' | 'import' | 'move'

export interface ExportForm {
  name: string
  path: string
  format: BackupFormat
  /** 运行中发行版是否允许先终止再导出（WSL --export 会终止它） */
  terminateFirst?: boolean
}

export interface ImportForm {
  name: string
  archivePath: string
  installPath: string
  format: BackupFormat
  version: 1 | 2
  inPlace: boolean
}

export interface MoveForm {
  name: string
  path: string
  terminateFirst: boolean
}

export interface SummaryRow {
  label: string
  value: string
}

export const DEFAULT_EXPORT_FORM: ExportForm = {
  name: '',
  path: '',
  format: 'tar',
  terminateFirst: false,
}

export const DEFAULT_IMPORT_FORM: ImportForm = {
  name: '',
  archivePath: '',
  installPath: '',
  format: 'tar',
  version: 2,
  inPlace: false,
}

export const DEFAULT_MOVE_FORM: MoveForm = {
  name: '',
  path: '',
  terminateFirst: true,
}

/** 发行版名合法性（与执行边界 assertSafeDistroName 同一实现 — review M3 收敛） */
export function isValidDistroName(name: string): boolean {
  try {
    assertSafeDistroName(name)
    return true
  } catch {
    return false
  }
}

/** 建议备份文件完整路径（默认目录 + 命名规范）；目录为空时只给文件名（绝不生成根相对 `\文件名`） */
export function suggestedBackupPath(
  defaultDir: string,
  name: string,
  format: BackupFormat,
  at: Date = new Date(),
): string {
  const dir = (defaultDir ?? '').trim().replace(/[\\/]+$/, '')
  const file = exportFileName(name, format, at)
  if (!dir) return file
  const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\'
  return `${dir}${sep}${file}`
}

function requireField(value: string, label: string): string | null {
  if (!value || !value.trim()) return `请填写${label}`
  return null
}

/** 路径中的控制字符（含 NUL/换行等）：进入文件系统/命令行前拦截（review 0.1.2 根治） */
// eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/

/** 路径字段校验：必填（可选）+ 控制字符 */
function validatePathField(value: string, label: string, required = true): string | null {
  if (required) {
    const err = requireField(value, label)
    if (err) return err
  }
  if (value && CONTROL_CHARS_RE.test(value)) return `${label}包含非法控制字符`
  return null
}

export function validateExportForm(form: ExportForm): string | null {
  const name = form.name.trim()
  if (!name) return '请填写发行版'
  // 与执行边界 assertSafeDistroName 同源：非法名不得一路「下一步」到长任务里才炸（review 0.1.2 根治）
  if (!isValidDistroName(name)) {
    return '发行版名称不合法（不能包含 \\ / : * ? " < > | 等字符）'
  }
  return validatePathField(form.path, '导出路径')
}

export function buildExportRequest(form: ExportForm): IoExportRequest {
  return {
    name: form.name.trim(),
    path: form.path.trim(),
    format: form.format,
    terminateFirst: form.terminateFirst === true,
  }
}

/** 备份格式展示名（0.1.4 增加 tar.gz） */
export function backupFormatLabel(format: BackupFormat): string {
  if (format === 'vhd') return 'vhd（vhdx 虚拟磁盘）'
  if (format === 'tar.gz') return 'tar.gz（gzip 压缩归档）'
  return 'tar（归档）'
}

export function exportSummary(form: ExportForm): SummaryRow[] {
  return [
    { label: '操作', value: '导出备份' },
    { label: '发行版', value: form.name || '—' },
    { label: '保存到', value: form.path || '—' },
    { label: '格式', value: backupFormatLabel(form.format) },
    ...(form.terminateFirst
      ? [{ label: '运行中处理', value: '先停止发行版（会关闭其中的终端与进程）' }]
      : []),
  ]
}

export function exportCommandPreview(form: ExportForm): string {
  return previewExportCommand(buildExportRequest(form))
}

/**
 * 导入表单校验。
 * `existingNames` 为当前已注册发行版名：重名必须**硬拦截**，
 * 否则用户一路「下一步 → 开始」才在长任务里炸出 wsl --import 同名冲突（review M-11）。
 */
export function validateImportForm(
  form: ImportForm,
  existingNames: readonly string[] = [],
): string | null {
  if (!isValidDistroName(form.name))
    return '请填写合法的新发行版名称（不能包含 \\ / : * ? " < > |）'
  const n = form.name.trim()
  // 大小写归一（review 0.1.2 审计修复）：WSL 发行版名不区分大小写，
  // Ubuntu/ubuntu 视为重名，否则拖到 wsl --import 长任务才炸同名冲突
  const lower = n.toLowerCase()
  if (existingNames.some((d) => d.toLowerCase() === lower)) {
    return `发行版「${n}」已存在，请换一个名称，或先注销原有发行版`
  }
  const err = validatePathField(form.archivePath, '备份文件路径')
  if (err) return err
  // 扩展名与格式必须一致：用户在选完 vhdx 后切回「归档导入」时，不能让
  // `--import`（无 --vhd）去解一个 vhdx（反之亦然）；否则长任务跑到一半才失败。
  const lowerPath = form.archivePath.trim().toLowerCase()
  const detected: BackupFormat = /\.vhdx?$/i.test(lowerPath)
    ? 'vhd'
    : /\.(?:tar\.gz|tgz)$/i.test(lowerPath)
      ? 'tar.gz'
      : 'tar'
  if (detected !== form.format) {
    return `文件扩展名与导入格式不一致：当前格式为 ${form.format}，文件看起来是 ${detected}；请重新选择文件或切换导入方式`
  }
  if (form.inPlace && form.format !== 'vhd') {
    return '就地导入仅支持 vhd（.vhdx）文件，请改用归档导入'
  }
  if (!form.inPlace) return validatePathField(form.installPath, '安装位置')
  return null
}

export function buildImportRequest(form: ImportForm): IoImportRequest {
  return {
    name: form.name.trim(),
    installPath: form.inPlace ? '' : form.installPath.trim(),
    archivePath: form.archivePath.trim(),
    format: form.format,
    version: form.version === 1 ? 1 : 2,
    inPlace: form.inPlace,
  }
}

export function importSummary(form: ImportForm): SummaryRow[] {
  return [
    { label: '操作', value: form.inPlace ? '就地导入（vhdx 原地注册）' : '从备份导入' },
    { label: '新发行版名称', value: form.name || '—' },
    { label: '备份文件', value: form.archivePath || '—' },
    form.inPlace
      ? { label: '安装位置', value: '（就地使用源 vhdx，不复制）' }
      : { label: '安装位置', value: form.installPath || '—' },
    { label: '格式', value: backupFormatLabel(form.format) },
    ...(form.format !== 'vhd' && !form.inPlace
      ? [{ label: 'WSL 版本', value: form.version === 1 ? 'WSL 1' : 'WSL 2' }]
      : []),
  ]
}

export function importCommandPreview(form: ImportForm): string {
  return previewImportCommand(buildImportRequest(form))
}

export function validateMoveForm(form: MoveForm): string | null {
  return requireField(form.name, '发行版') ?? validatePathField(form.path, '迁移目标位置')
}

export function buildMoveRequest(form: MoveForm): IoMoveRequest {
  return {
    name: form.name.trim(),
    path: form.path.trim(),
    terminateFirst: form.terminateFirst === true,
  }
}

export function moveSummary(
  form: MoveForm,
  opts: { willTerminate: boolean; autoBackup: boolean },
): SummaryRow[] {
  const rows: SummaryRow[] = [
    { label: '操作', value: '迁移磁盘' },
    { label: '发行版', value: form.name || '—' },
    { label: '迁移到', value: form.path || '—' },
  ]
  if (opts.willTerminate) {
    rows.push({
      label: '运行中处理',
      value: form.terminateFirst ? '先终止（terminate）再迁移' : '—（将报错中止）',
    })
  }
  rows.push({
    label: '迁移前自动备份',
    value: opts.autoBackup ? '开启（安全兜底，导出到备份目录）' : '关闭',
  })
  return rows
}

export function moveCommandPreview(form: MoveForm): string {
  return previewMoveCommand(buildMoveRequest(form))
}

/** 摘要行 → 模板渲染用 */
export function summaryToText(rows: SummaryRow[]): string {
  return rows.map((r) => `${r.label}：${r.value}`).join('\n')
}
