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
    // 非法字符 %XX 转义（不与 `_` 形态碰撞）
    expect(exportFileName('a:b', 'vhd', at)).toBe('a%3Ab_20260102-030405.vhdx')
  })

  it('sanitizes ALL illegal chars（%XX 无碰撞转义 — review C3 + 数据安全回归）', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5)
    expect(exportFileName('a:b:c', 'tar', at)).toBe('a%3Ab%3Ac_20260102-030405.tar')
    expect(exportFileName('a/b\\c:d*e', 'tar', at)).toBe('a%2Fb%5Cc%3Ad%2Ae_20260102-030405.tar')
    expect(exportFileName('q?"<>|', 'tar', at)).toBe('q%3F%22%3C%3E%7C_20260102-030405.tar')
    const withControl = exportFileName('a\u0000b', 'tar', at)
    expect(withControl).toBe('a%00b_20260102-030405.tar')
    // `%` 自身先转义，保证映射可往返无碰撞
    expect(exportFileName('a%2Ab', 'tar', at)).toBe('a%252Ab_20260102-030405.tar')
  })

  it('命名无碰撞：`a*b` 与 `a_b` 不同文件族（轮转绝不误删）', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5)
    const withStar = exportFileName('a*b', 'tar', at)
    const withUnderscore = exportFileName('a_b', 'tar', at)
    expect(withStar).not.toBe(withUnderscore)
    // 各自的轮转正则只匹配自己的文件
    expect(backupFileRegex('a*b').test(withStar)).toBe(true)
    expect(backupFileRegex('a*b').test(withUnderscore)).toBe(false)
    expect(backupFileRegex('a_b').test(withUnderscore)).toBe(true)
  })

  it('round-trip: regex always matches its own exportFileName (review C3)', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5)
    for (const name of ['a:b:c', 'a/b\\c:d*e', 'q?"<>|', 'Ubuntu', 'x\u0000y', '中 文']) {
      for (const fmt of ['tar', 'vhd'] as const) {
        const file = exportFileName(name, fmt, at)
        expect(backupFileRegex(name).test(file), `round-trip failed for ${name}`).toBe(true)
      }
    }
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
