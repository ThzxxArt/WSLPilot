import { describe, it, expect } from 'vitest'
import { parseIpcArgs, IPC_SCHEMAS, nameSchema, configKeySchema } from '../src/ipc-schema'
import { CH } from '../src/channels'

describe('ipc-schema', () => {
  it('parses distro name', () => {
    expect(parseIpcArgs(CH.distrosStart, ['Ubuntu'])).toBe('Ubuntu')
    expect(parseIpcArgs(CH.distrosStart, ['Ubuntu 22.04'])).toBe('Ubuntu 22.04')
  })

  it('rejects empty name', () => {
    expect(() => parseIpcArgs(CH.distrosStart, [''])).toThrow()
    expect(() => nameSchema.parse('')).toThrow()
    expect(() => nameSchema.parse('a/../b')).toThrow()
  })

  it('parses configKey', () => {
    expect(parseIpcArgs(CH.configGet, ['settings'])).toBe('settings')
    expect(() => parseIpcArgs(CH.configGet, ['evil'])).toThrow()
    expect(() => configKeySchema.parse('nope')).toThrow()
  })

  it('parses configSet payload', () => {
    const out = parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: { general: {} } }])
    expect(out).toMatchObject({ fileKey: 'settings' })
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'bad', patch: {} }])).toThrow()
  })

  it('parses resolveConflict action', () => {
    expect(
      parseIpcArgs(CH.configResolveConflict, [{ fileKey: 'settings', action: 'reload' }]),
    ).toMatchObject({ action: 'reload' })
    expect(() =>
      parseIpcArgs(CH.configResolveConflict, [{ fileKey: 'settings', action: 'hack' }]),
    ).toThrow()
  })

  it('passes through channels without schema', () => {
    expect(parseIpcArgs(CH.distrosList, [])).toBeUndefined()
    expect(parseIpcArgs(CH.appGetVersion, [])).toBeUndefined()
  })

  it('metaSet validates payload', () => {
    expect(() => parseIpcArgs(CH.metaSet, [{ alias: 'x' }])).toThrow()
    expect(parseIpcArgs(CH.metaSet, [{ name: 'Ubuntu', alias: 'a' }])).toMatchObject({
      name: 'Ubuntu',
    })
  })

  it('validates pty create/input/resize/kill payloads', () => {
    expect(parseIpcArgs(CH.ptyCreate, [{ distro: 'Ubuntu', cols: 80, rows: 24 }])).toMatchObject({
      distro: 'Ubuntu',
      cols: 80,
    })
    expect(() => parseIpcArgs(CH.ptyCreate, [{ distro: '', cols: 80, rows: 24 }])).toThrow()
    expect(() => parseIpcArgs(CH.ptyInput, [{ ptyId: '', data: 'x' }])).toThrow()
    expect(parseIpcArgs(CH.ptyInput, [{ ptyId: 'p1', data: 'ls\n' }])).toMatchObject({
      ptyId: 'p1',
    })
    expect(() => parseIpcArgs(CH.ptyKill, [''])).toThrow()
    expect(parseIpcArgs(CH.ptyKill, ['p1'])).toBe('p1')
    expect(() => parseIpcArgs(CH.ptyResize, [{ ptyId: 'p1', cols: 1, rows: 10 }])).toThrow()
  })

  it('rejects prototype pollution keys in patch', () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true}}')
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: evil }])).toThrow()
    const evil2 = JSON.parse('{"constructor":{"x":1}}')
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: evil2 }])).toThrow()
    // 正常 patch 可通过
    expect(
      parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: { general: {} } }]),
    ).toBeTruthy()
  })

  it('every multi-arg IPC channel that is used in M1+M2 has a schema', () => {
    // 契约：注册了 handler 且带参的通道必须登记 schema，防止 M3 漏校验
    const required = [
      CH.distrosStart,
      CH.distrosTerminate,
      CH.distrosSetDefault,
      CH.registryDetail,
      CH.metaGet,
      CH.metaSet,
      CH.metricsSample,
      CH.configGet,
      CH.configSet,
      CH.configOpenExternal,
      CH.configResolveConflict,
    ]
    for (const ch of required) {
      expect(IPC_SCHEMAS[ch], `missing schema for ${ch}`).toBeTruthy()
    }
    // void 通道不应有 schema
    expect(IPC_SCHEMAS[CH.distrosList]).toBeUndefined()
    expect(IPC_SCHEMAS[CH.appGetVersion]).toBeUndefined()
  })
})

describe('ipc-schema · M4 备份迁移通道', () => {
  it('io:export validates name / path / format', () => {
    expect(
      parseIpcArgs(CH.ioExport, [{ name: 'Ubuntu', path: 'C:\\b\\u.tar', format: 'tar' }]),
    ).toEqual({ name: 'Ubuntu', path: 'C:\\b\\u.tar', format: 'tar' })
    expect(() => parseIpcArgs(CH.ioExport, [{ name: '', path: 'C:\\x', format: 'tar' }])).toThrow()
    expect(() => parseIpcArgs(CH.ioExport, [{ name: 'U', path: '', format: 'tar' }])).toThrow()
    expect(() =>
      parseIpcArgs(CH.ioExport, [{ name: 'U', path: 'a\u0000b', format: 'tar' }]),
    ).toThrow()
    expect(() => parseIpcArgs(CH.ioExport, [{ name: 'U', path: 'C:\\x', format: 'zip' }])).toThrow()
  })

  it('io:import validates payload and fills defaults', () => {
    const out = parseIpcArgs(CH.ioImport, [
      {
        name: 'New',
        installPath: 'D:\\N',
        archivePath: 'D:\\a.tar',
        format: 'tar',
      },
    ]) as { version: number; inPlace: boolean }
    expect(out.version).toBe(2)
    expect(out.inPlace).toBe(false)

    expect(() =>
      parseIpcArgs(CH.ioImport, [{ name: 'N', installPath: '', archivePath: '', format: 'tar' }]),
    ).toThrow()
    // 就地导入：installPath 允许为空
    expect(
      parseIpcArgs(CH.ioImport, [
        {
          name: 'N',
          installPath: '',
          archivePath: 'D:\\a.vhdx',
          format: 'vhd',
          inPlace: true,
        },
      ]),
    ).toMatchObject({ inPlace: true, installPath: '' })
    expect(() =>
      parseIpcArgs(CH.ioImport, [
        { name: 'N', installPath: 'D:\\N', archivePath: 'D:\\a.tar', format: 'tar', version: 3 },
      ]),
    ).toThrow()
    expect(() =>
      parseIpcArgs(CH.ioImport, [
        {
          name: 'N',
          installPath: 'D:\\N',
          archivePath: 'D:\\a.tar',
          format: 'tar',
          version: 1,
          inPlace: 'yes',
        },
      ]),
    ).toThrow()
  })

  it('io:move validates payload and defaults terminateFirst', () => {
    const out = parseIpcArgs(CH.ioMove, [{ name: 'U', path: 'D:\\U' }]) as {
      terminateFirst: boolean
    }
    expect(out.terminateFirst).toBe(false)
    expect(() => parseIpcArgs(CH.ioMove, [{ name: 'U', path: '' }])).toThrow()
    expect(() => parseIpcArgs(CH.ioMove, [{ name: '', path: 'D:\\U' }])).toThrow()
  })

  it('io:listBackups accepts empty / optional dir', () => {
    expect(parseIpcArgs(CH.ioListBackups, [{}])).toEqual({})
    expect(parseIpcArgs(CH.ioListBackups, [])).toEqual({})
    expect(parseIpcArgs(CH.ioListBackups, [{ dir: 'D:\\bk' }])).toEqual({ dir: 'D:\\bk' })
    expect(() => parseIpcArgs(CH.ioListBackups, [{ dir: '' }])).toThrow()
  })

  it('task:cancel validates taskId', () => {
    expect(parseIpcArgs(CH.taskCancel, ['t-1'])).toBe('t-1')
    expect(() => parseIpcArgs(CH.taskCancel, [''])).toThrow()
  })

  it('app pickers validate optional args', () => {
    expect(parseIpcArgs(CH.appPickDirectory, [])).toEqual({})
    expect(parseIpcArgs(CH.appPickDirectory, [{ defaultPath: 'D:\\x' }])).toEqual({
      defaultPath: 'D:\\x',
    })
    expect(() => parseIpcArgs(CH.appPickDirectory, [{ defaultPath: '' }])).toThrow()

    const save = parseIpcArgs(CH.appPickSaveFile, [
      { suggestedName: 'a.tar', filters: [{ name: 'TAR', extensions: ['tar'] }] },
    ]) as { suggestedName: string }
    expect(save.suggestedName).toBe('a.tar')
    expect(() =>
      parseIpcArgs(CH.appPickSaveFile, [{ filters: [{ name: 'x', extensions: [] }] }]),
    ).toThrow()
    expect(parseIpcArgs(CH.appPickOpenFile, [])).toEqual({})
    expect(() => parseIpcArgs(CH.appPickOpenFile, [{ defaultPath: 'a\u0001b' }])).toThrow()
    expect(parseIpcArgs(CH.appOpenPath, ['D:\\x'])).toBe('D:\\x')
    expect(() => parseIpcArgs(CH.appOpenPath, [''])).toThrow()
  })

  it('M4 invoke channels all carry schemas', () => {
    for (const ch of [
      CH.ioExport,
      CH.ioImport,
      CH.ioMove,
      CH.ioListBackups,
      CH.taskCancel,
      CH.appPickDirectory,
      CH.appPickSaveFile,
      CH.appPickOpenFile,
      CH.appOpenPath,
    ]) {
      expect(IPC_SCHEMAS[ch], `missing schema for ${ch}`).toBeTruthy()
    }
  })
})
