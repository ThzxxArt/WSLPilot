import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { createZip } from '@wslpilot/kit'
import {
  collectRecentLogs,
  createDiagnosticsService,
  normalizeDiagnosticsTarget,
} from '../../src/main/services/diagnostics-service'

const logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  setLevel: vi.fn(),
}

let root = ''

function readZipNames(buf: Buffer): string[] {
  const names: string[] = []
  let offset = 0
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8)
    const csize = buf.readUInt32LE(offset + 18)
    const nlen = buf.readUInt16LE(offset + 26)
    const elen = buf.readUInt16LE(offset + 28)
    const name = buf.subarray(offset + 30, offset + 30 + nlen).toString('utf8')
    names.push(name)
    void method
    void csize
    offset = offset + 30 + nlen + elen + csize
  }
  return names
}

function readZipContent(buf: Buffer, wanted: string): string {
  let offset = 0
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8)
    const csize = buf.readUInt32LE(offset + 18)
    const nlen = buf.readUInt16LE(offset + 26)
    const elen = buf.readUInt16LE(offset + 28)
    const name = buf.subarray(offset + 30, offset + 30 + nlen).toString('utf8')
    const dataStart = offset + 30 + nlen + elen
    const raw = buf.subarray(dataStart, dataStart + csize)
    if (name === wanted) {
      return (method === 8 ? inflateRawSync(raw) : Buffer.from(raw)).toString('utf8')
    }
    offset = dataStart + csize
  }
  throw new Error(`entry not found: ${wanted}`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wslpilot-diag-'))
  mkdirSync(join(root, 'logs'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('collectRecentLogs', () => {
  it('按时间倒序取近期日志、限量限体积', async () => {
    writeFileSync(join(root, 'logs', 'app-20261008.log'), 'a'.repeat(10))
    writeFileSync(join(root, 'logs', 'app-20261009.log'), 'b'.repeat(10))
    writeFileSync(join(root, 'logs', 'app-20261010.log'), 'c'.repeat(10))
    writeFileSync(join(root, 'logs', 'other.log'), 'x')
    const files = await collectRecentLogs(join(root, 'logs'), 2)
    expect(files.map((f) => f.name)).toEqual(['app-20261010.log', 'app-20261009.log'])
    const limited = await collectRecentLogs(join(root, 'logs'), 10, 15)
    // 15 字节上限：装不下第二个就停
    expect(limited.length).toBe(1)
    expect(await collectRecentLogs(join(root, 'nope'))).toEqual([])
  })
})

describe('诊断服务（M7 §15.3）', () => {
  it('exportTo：日志 + 配置脱敏副本 + manifest → zip', async () => {
    writeFileSync(join(root, 'logs', 'app-20261010.log'), 'log at C:\\Users\\me\\x\n')
    writeFileSync(
      join(root, 'settings.jsonc'),
      '{ "backup": { "defaultDir": "C:\\\\Users\\\\me\\\\WSL-Backups" } }\n',
    )
    writeFileSync(join(root, 'distros.jsonc'), '{ "distros": [] }\n')

    const svc = createDiagnosticsService({
      logger,
      userDataDir: root,
      appVersion: '0.1.0',
      homeDir: 'C:\\Users\\me',
      now: () => new Date(2026, 9, 10, 12, 0, 0),
      wslVersion: async () => ({ wslVersion: '2.0', kernelVersion: '5.15', raw: 'raw' }),
    })
    const target = join(root, 'out.zip')
    const result = await svc.exportTo(target)

    expect(result.path).toBe(target)
    expect(result.entries).toContain('manifest.json')
    expect(result.entries).toContain('logs/app-20261010.log')
    expect(result.entries).toContain('config/settings.jsonc')
    expect(result.entries).toContain('config/distros.jsonc')

    const zip = await fs.readFile(target)
    // 脱敏：主目录 → %USERPROFILE%
    const logText = readZipContent(zip, 'logs/app-20261010.log')
    expect(logText).toContain('%USERPROFILE%')
    expect(logText).not.toContain('C:\\Users\\me')
    const cfgText = readZipContent(zip, 'config/settings.jsonc')
    expect(cfgText).toContain('%USERPROFILE%')

    const manifest = JSON.parse(readZipContent(zip, 'manifest.json'))
    expect(manifest.app.version).toBe('0.1.0')
    expect(manifest.wsl.wslVersion).toBe('2.0')
    expect(manifest.note).toContain('脱敏')
    expect(manifest.logs[0].name).toBe('app-20261010.log')
    expect(svc.defaultFileName()).toMatch(/^WSLPilot-diagnostics-.*\.zip$/)
    expect(svc.logsPath()).toBe(join(root, 'logs'))
  })

  it('openLogsDir：确保目录存在并调用 opener', async () => {
    const openDirectory = vi.fn(async () => '')
    const svc = createDiagnosticsService({
      logger,
      userDataDir: root,
      appVersion: '0.1.0',
      openDirectory,
    })
    await svc.openLogsDir()
    expect(openDirectory).toHaveBeenCalledWith(join(root, 'logs'))
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('openLogsDir：opener 失败只记录不抛', async () => {
    const openDirectory = vi.fn(async () => 'busy')
    const svc = createDiagnosticsService({
      logger,
      userDataDir: root,
      appVersion: '0.1.0',
      openDirectory,
    })
    await expect(svc.openLogsDir()).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('缺日志/缺配置/WSL 版本失败均不阻断导出', async () => {
    const svc = createDiagnosticsService({
      logger,
      userDataDir: root,
      appVersion: '0.1.0',
      wslVersion: async () => {
        throw new Error('no wsl')
      },
    })
    const result = await svc.exportTo(join(root, 'out.zip'))
    expect(result.entries).toEqual(['manifest.json'])
  })

  it('normalizeDiagnosticsTarget：补 .zip、拒绝空名', () => {
    expect(normalizeDiagnosticsTarget('C:\\x\\diag')).toBe('C:\\x\\diag.zip')
    expect(normalizeDiagnosticsTarget('C:\\x\\diag.zip')).toBe('C:\\x\\diag.zip')
    expect(() => normalizeDiagnosticsTarget('')).toThrow()
    expect(() => normalizeDiagnosticsTarget('C:\\x\\.zip')).toThrow()
    expect(readZipNames(createZip([]))).toEqual([])
  })
})
