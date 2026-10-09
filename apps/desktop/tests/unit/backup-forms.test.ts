import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EXPORT_FORM,
  DEFAULT_IMPORT_FORM,
  DEFAULT_MOVE_FORM,
  isValidDistroName,
  suggestedBackupPath,
  validateExportForm,
  buildExportRequest,
  exportSummary,
  exportCommandPreview,
  validateImportForm,
  buildImportRequest,
  importSummary,
  importCommandPreview,
  validateMoveForm,
  buildMoveRequest,
  moveSummary,
  moveCommandPreview,
  summaryToText,
} from '../../src/renderer/features/backup/forms'

describe('isValidDistroName', () => {
  it('accepts normal names including Chinese and spaces', () => {
    expect(isValidDistroName('Ubuntu-22.04')).toBe(true)
    expect(isValidDistroName('我的发行版')).toBe(true)
    expect(isValidDistroName('a b')).toBe(true)
    // `*` 为 wsl 合法名字字符（列表可见必须可操作），文件名由 sanitize 兜底
    expect(isValidDistroName('a*b')).toBe(true)
    expect(isValidDistroName('*mydistro')).toBe(true)
  })

  it('rejects empty, control chars, traversal and illegal filename chars', () => {
    expect(isValidDistroName('')).toBe(false)
    expect(isValidDistroName('   ')).toBe(false)
    expect(isValidDistroName('a\u0000b')).toBe(false)
    expect(isValidDistroName('../evil')).toBe(false)
    expect(isValidDistroName('a/b')).toBe(false)
    expect(isValidDistroName('a:b')).toBe(false)
    expect(isValidDistroName('a|b')).toBe(false)
    expect(isValidDistroName('a<b')).toBe(false)
    expect(isValidDistroName(null as never)).toBe(false)
  })
})

describe('suggestedBackupPath', () => {
  it('joins defaultDir with naming convention file', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5)
    expect(suggestedBackupPath('C:\\Backups', 'Ubuntu', 'tar', at)).toBe(
      'C:\\Backups\\Ubuntu_20260102-030405.tar',
    )
    expect(suggestedBackupPath('/home/u/bk/', 'Ubuntu', 'vhd', at)).toBe(
      '/home/u/bk/Ubuntu_20260102-030405.vhdx',
    )
    expect(suggestedBackupPath('', 'U', 'tar', at)).toMatch(/U_20260102-030405\.tar$/)
  })
})

describe('export form', () => {
  it('validates required fields and builds request', () => {
    expect(validateExportForm(DEFAULT_EXPORT_FORM)).toContain('发行版')
    expect(validateExportForm({ ...DEFAULT_EXPORT_FORM, name: 'U' })).toContain('导出路径')
    expect(validateExportForm({ name: 'U', path: 'C:\\x.tar', format: 'tar' })).toBeNull()

    const req = buildExportRequest({ name: ' U ', path: '  C:\\x.tar  ', format: 'vhd' })
    expect(req).toEqual({ name: 'U', path: 'C:\\x.tar', format: 'vhd' })
  })

  it('summary rows and command preview reflect the form', () => {
    const form = { name: 'Ubuntu', path: 'C:\\b\\u.tar', format: 'tar' as const }
    const rows = exportSummary(form)
    expect(rows.find((r) => r.label === '发行版')?.value).toBe('Ubuntu')
    expect(rows.find((r) => r.label === '格式')?.value).toContain('tar')
    expect(exportCommandPreview(form)).toBe('wsl.exe --export Ubuntu "C:\\b\\u.tar"')
    expect(summaryToText(rows)).toContain('导出备份')
    expect(
      exportSummary({ ...form, format: 'vhd' }).find((r) => r.label === '格式')?.value,
    ).toContain('vhd')
  })
})

describe('import form', () => {
  it('validates name, archive and install path', () => {
    expect(validateImportForm(DEFAULT_IMPORT_FORM)).toContain('发行版')
    expect(validateImportForm({ ...DEFAULT_IMPORT_FORM, name: 'bad/name' })).toContain('发行版')
    expect(validateImportForm({ ...DEFAULT_IMPORT_FORM, name: 'New', archivePath: '' })).toContain(
      '备份文件',
    )
    expect(
      validateImportForm({ ...DEFAULT_IMPORT_FORM, name: 'New', archivePath: 'a.tar' }),
    ).toContain('安装位置')
    expect(
      validateImportForm({
        name: 'New',
        archivePath: 'a.tar',
        installPath: 'D:\\New',
        format: 'tar',
        version: 2,
        inPlace: false,
      }),
    ).toBeNull()
    expect(
      validateImportForm({
        name: 'New',
        archivePath: 'a.vhdx',
        installPath: '',
        format: 'vhd',
        version: 2,
        inPlace: true,
      }),
    ).toBeNull()
  })

  it('builds request and summaries per mode', () => {
    const tar = {
      name: ' New ',
      archivePath: ' a.tar ',
      installPath: ' D:\\N ',
      format: 'tar' as const,
      version: 1 as const,
      inPlace: false,
    }
    expect(buildImportRequest(tar)).toEqual({
      name: 'New',
      installPath: 'D:\\N',
      archivePath: 'a.tar',
      format: 'tar',
      version: 1,
      inPlace: false,
    })
    expect(importCommandPreview(tar)).toBe('wsl.exe --import New "D:\\N" a.tar --version 1')
    expect(importSummary(tar).find((r) => r.label === 'WSL 版本')?.value).toBe('WSL 1')

    const inplace = { ...tar, inPlace: true, format: 'vhd' as const }
    const req = buildImportRequest(inplace)
    expect(req.inPlace).toBe(true)
    expect(req.installPath).toBe('')
    expect(importCommandPreview(inplace)).toContain('--import-in-place')
    const rows = importSummary(inplace)
    expect(rows.find((r) => r.label === '安装位置')?.value).toContain('就地')
    expect(rows.find((r) => r.label === 'WSL 版本')).toBeUndefined()
    expect(rows.find((r) => r.label === '操作')?.value).toContain('就地导入')

    const vhdCopy = { ...tar, format: 'vhd' as const }
    expect(importCommandPreview(vhdCopy)).toContain('--vhd')
    expect(importSummary(vhdCopy).find((r) => r.label === 'WSL 版本')).toBeUndefined()
    expect(importSummary(DEFAULT_IMPORT_FORM).find((r) => r.label === '新发行版名称')?.value).toBe(
      '—',
    )
  })
})

describe('move form', () => {
  it('validates and builds request', () => {
    expect(validateMoveForm(DEFAULT_MOVE_FORM)).toContain('发行版')
    expect(validateMoveForm({ ...DEFAULT_MOVE_FORM, name: 'U' })).toContain('迁移目标')
    expect(validateMoveForm({ name: 'U', path: 'D:\\U', terminateFirst: true })).toBeNull()
    expect(buildMoveRequest({ name: ' U ', path: ' D:\\U ', terminateFirst: false })).toEqual({
      name: 'U',
      path: 'D:\\U',
      terminateFirst: false,
    })
  })

  it('summary shows terminate and auto-backup policy', () => {
    const form = { name: 'Ubuntu', path: 'D:\\Ubuntu', terminateFirst: true }
    const rows = moveSummary(form, { willTerminate: true, autoBackup: true })
    expect(rows.find((r) => r.label === '运行中处理')?.value).toContain('terminate')
    expect(rows.find((r) => r.label === '迁移前自动备份')?.value).toContain('开启')

    const rows2 = moveSummary(
      { ...form, terminateFirst: false },
      { willTerminate: true, autoBackup: false },
    )
    expect(rows2.find((r) => r.label === '运行中处理')?.value).toContain('中止')
    expect(rows2.find((r) => r.label === '迁移前自动备份')?.value).toBe('关闭')

    const rows3 = moveSummary(form, { willTerminate: false, autoBackup: true })
    expect(rows3.find((r) => r.label === '运行中处理')).toBeUndefined()
    expect(moveCommandPreview(form)).toBe('wsl.exe --manage Ubuntu --move "D:\\Ubuntu"')
  })
})
