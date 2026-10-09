import { describe, it, expect } from 'vitest'
import {
  formatCommand,
  previewExportCommand,
  previewImportCommand,
  previewMoveCommand,
  backupExtension,
  exportFileName,
  backupFileRegex,
  isBackupFileName,
} from './commands'
import { formatBytes } from './format'

describe('formatCommand', () => {
  it('quotes args containing spaces and leaves simple args bare', () => {
    expect(formatCommand('wsl.exe', ['-e', 'ls'])).toBe('wsl.exe -e ls')
    expect(formatCommand('wsl.exe', ['--export', 'Ubuntu 22', 'C:\\my dir\\a.tar'])).toBe(
      'wsl.exe --export "Ubuntu 22" "C:\\my dir\\a.tar"',
    )
  })

  it('escapes embedded quotes', () => {
    expect(formatCommand('x', ['a"b'])).toBe('x "a\\"b"')
  })
})

describe('preview commands (display only)', () => {
  it('previewExportCommand appends --vhd for vhd format', () => {
    expect(previewExportCommand({ name: 'U', path: 'C:\\b\\u.tar', format: 'tar' })).toBe(
      'wsl.exe --export U "C:\\b\\u.tar"',
    )
    expect(previewExportCommand({ name: 'U', path: 'C:\\b\\u.vhdx', format: 'vhd' })).toBe(
      'wsl.exe --export U "C:\\b\\u.vhdx" --vhd',
    )
    expect(previewExportCommand({ name: 'U', path: '/tmp/u.tar', format: 'tar' })).toBe(
      'wsl.exe --export U /tmp/u.tar',
    )
  })

  it('previewImportCommand branches on inPlace / format / version', () => {
    expect(
      previewImportCommand({
        name: 'N',
        installPath: 'D:\\N',
        archivePath: 'D:\\a.tar',
        format: 'tar',
        version: 2,
        inPlace: false,
      }),
    ).toBe('wsl.exe --import N "D:\\N" "D:\\a.tar" --version 2')

    expect(
      previewImportCommand({
        name: 'N',
        installPath: 'D:\\N',
        archivePath: 'D:\\a.vhdx',
        format: 'vhd',
        version: 1,
        inPlace: false,
      }),
    ).toBe('wsl.exe --import N "D:\\N" "D:\\a.vhdx" --vhd')

    expect(
      previewImportCommand({
        name: 'N',
        installPath: '',
        archivePath: 'D:\\a.vhdx',
        format: 'vhd',
        version: 2,
        inPlace: true,
      }),
    ).toBe('wsl.exe --import-in-place N "D:\\a.vhdx"')

    expect(
      previewImportCommand({
        name: 'N',
        installPath: 'D:\\N',
        archivePath: 'D:\\a.tar',
        format: 'tar',
        version: 1,
        inPlace: false,
      }),
    ).toContain('--version 1')
  })

  it('previewMoveCommand shows --manage --move', () => {
    expect(previewMoveCommand({ name: 'U', path: 'D:\\U', terminateFirst: true })).toBe(
      'wsl.exe --manage U --move "D:\\U"',
    )
    expect(previewMoveCommand({ name: 'U', path: '/mnt/d/U', terminateFirst: true })).toBe(
      'wsl.exe --manage U --move /mnt/d/U',
    )
  })
})

describe('backup naming & rotation pattern', () => {
  it('backupExtension maps vhd → vhdx', () => {
    expect(backupExtension('tar')).toBe('tar')
    expect(backupExtension('vhd')).toBe('vhdx')
  })

  it('exportFileName embeds sortable timestamp and sanitizes illegal chars', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5)
    expect(exportFileName('Ubuntu-22.04', 'tar', at)).toBe('Ubuntu-22.04_20260102-030405.tar')
    expect(exportFileName('a:b', 'vhd', at)).toBe('a_b_20260102-030405.vhdx')
  })

  it('backupFileRegex matches only the exact distro name', () => {
    const re = backupFileRegex('Ubuntu')
    expect(re.test('Ubuntu_20260102-030405.tar')).toBe(true)
    expect(re.test('Ubuntu_20260102-030405.vhdx')).toBe(true)
    expect(re.test('Ubuntu-22.04_20260102-030405.tar')).toBe(false)
    expect(re.test('Ubuntu_20260102-030405.txt')).toBe(false)
  })

  it('backupFileRegex escapes regex metacharacters in name', () => {
    const re = backupFileRegex('a.b')
    expect(re.test('a.b_20260102-030405.tar')).toBe(true)
    expect(re.test('axb_20260102-030405.tar')).toBe(false)
  })

  it('isBackupFileName validates the naming convention', () => {
    expect(isBackupFileName('U_20260102-030405.tar')).toBe(true)
    expect(isBackupFileName('U_20260102-030405.vhdx')).toBe(true)
    expect(isBackupFileName('U_20260102-030405.zip')).toBe(false)
    expect(isBackupFileName('random.tar')).toBe(false)
    expect(isBackupFileName('a/b_20260102-030405.tar')).toBe(false)
  })
})

describe('formatBytes', () => {
  it('formats byte magnitudes', () => {
    expect(formatBytes(0)).toBe('0B')
    expect(formatBytes(-1)).toBe('0B')
    expect(formatBytes(Number.NaN)).toBe('0B')
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(2048)).toBe('2.0KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0GB')
  })
})
