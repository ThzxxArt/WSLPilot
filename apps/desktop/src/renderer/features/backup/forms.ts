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

/** 建议备份文件完整路径（默认目录 + 命名规范） */
export function suggestedBackupPath(
  defaultDir: string,
  name: string,
  format: BackupFormat,
  at: Date = new Date(),
): string {
  const dir = (defaultDir ?? '').trim().replace(/[\\/]+$/, '')
  const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\'
  return `${dir}${sep}${exportFileName(name, format, at)}`
}

function requireField(value: string, label: string): string | null {
  if (!value || !value.trim()) return `请填写${label}`
  return null
}

export function validateExportForm(form: ExportForm): string | null {
  return requireField(form.name, '发行版') ?? requireField(form.path, '导出路径')
}

export function buildExportRequest(form: ExportForm): IoExportRequest {
  return { name: form.name.trim(), path: form.path.trim(), format: form.format }
}

export function exportSummary(form: ExportForm): SummaryRow[] {
  return [
    { label: '操作', value: '导出备份' },
    { label: '发行版', value: form.name || '—' },
    { label: '保存到', value: form.path || '—' },
    { label: '格式', value: form.format === 'vhd' ? 'vhd（vhdx 虚拟磁盘）' : 'tar（归档）' },
  ]
}

export function exportCommandPreview(form: ExportForm): string {
  return previewExportCommand(buildExportRequest(form))
}

export function validateImportForm(form: ImportForm): string | null {
  if (!isValidDistroName(form.name))
    return '请填写合法的新发行版名称（不能包含 \\ / : * ? " < > |）'
  const err = requireField(form.archivePath, '备份文件路径')
  if (err) return err
  if (form.inPlace && form.format !== 'vhd') {
    return '就地导入仅支持 vhd（.vhdx）文件，请改用归档导入'
  }
  if (!form.inPlace) return requireField(form.installPath, '安装位置')
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
    { label: '格式', value: form.format === 'vhd' ? 'vhd（vhdx 虚拟磁盘）' : 'tar（归档）' },
    ...(form.format === 'tar' && !form.inPlace
      ? [{ label: 'WSL 版本', value: form.version === 1 ? 'WSL 1' : 'WSL 2' }]
      : []),
  ]
}

export function importCommandPreview(form: ImportForm): string {
  return previewImportCommand(buildImportRequest(form))
}

export function validateMoveForm(form: MoveForm): string | null {
  return requireField(form.name, '发行版') ?? requireField(form.path, '迁移目标位置')
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
