import { describe, it, expect, vi } from 'vitest'
import {
  createRegistryService,
  extractGuids,
  parseGuidDetail,
  parseRegDword,
  pickRegValue,
  type RegQuery,
} from '../../src/main/services/registry-service'

function logger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  } as any
}

const GUID_OUT = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{AAAA-BBBB}\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{CCCC-DDDD}\n'
const UBUNTU = '    DistributionName    REG_SZ    Ubuntu\n    BasePath    REG_SZ    C:\\WSL\\Ubuntu\n    Version    REG_DWORD    0x2\n    DefaultUid    REG_DWORD    0x3e8'
const DEBIAN = '    DistributionName    REG_SZ    Debian\n    Version    REG_DWORD    0x1'

function makeQuery(): RegQuery {
  return async (args: string[]) => {
    const line = args.join(' ')
    // 根查询：query HKCU\...\Lxss（不带 GUID）
    if (!line.includes('{')) return GUID_OUT
    if (line.includes('{AAAA-BBBB}')) return UBUNTU
    return DEBIAN
  }
}

describe('registry pure parsers', () => {
  it('extractGuids finds unique GUIDs', () => {
    expect(extractGuids(GUID_OUT)).toEqual(['{AAAA-BBBB}', '{CCCC-DDDD}'])
    expect(extractGuids('nothing here')).toEqual([])
  })

  it('pickRegValue reads REG_SZ and REG_DWORD', () => {
    expect(pickRegValue(UBUNTU, 'DistributionName')).toBe('Ubuntu')
    expect(pickRegValue(UBUNTU, 'DefaultUid')).toBe('0x3e8')
    expect(pickRegValue(UBUNTU, 'Nope')).toBeUndefined()
  })

  it('parseRegDword handles hex and decimal', () => {
    expect(parseRegDword('0x3e8')).toBe(1000)
    expect(parseRegDword('0x2')).toBe(2)
    expect(parseRegDword('42')).toBe(42)
    expect(parseRegDword(undefined)).toBeUndefined()
    expect(parseRegDword('zz')).toBeUndefined()
  })

  it('parseGuidDetail builds runtime shape', () => {
    const d = parseGuidDetail('{AAAA-BBBB}', UBUNTU)
    expect(d).toMatchObject({
      name: 'Ubuntu',
      basePath: 'C:\\WSL\\Ubuntu',
      version: 2,
      defaultUid: 1000,
      guid: '{AAAA-BBBB}',
    })
    expect(parseGuidDetail('{X}', '')).toEqual({})
    expect(parseGuidDetail('{X}', DEBIAN).version).toBe(1)
    expect(parseGuidDetail('{X}', DEBIAN).defaultUid).toBeUndefined()
  })
})

describe('createRegistryService', () => {
  it('listGuids maps names', async () => {
    const svc = createRegistryService(logger(), makeQuery())
    const guids = await svc.listGuids()
    expect(guids).toHaveLength(2)
    expect(guids.map((g) => g.distributionName)).toEqual(['Ubuntu', 'Debian'])
  })

  it('detail finds matching distro', async () => {
    const svc = createRegistryService(logger(), makeQuery())
    const d = await svc.detail('Ubuntu')
    expect(d.name).toBe('Ubuntu')
    expect(d.defaultUid).toBe(1000)
    expect(d.guid).toContain('AAAA')

    const d2 = await svc.detail('Debian')
    expect(d2.name).toBe('Debian')
    expect(d2.version).toBe(1)
  })

  it('detail returns empty when not found', async () => {
    const svc = createRegistryService(logger(), makeQuery())
    await expect(svc.detail('Nope')).resolves.toEqual({})
  })

  it('degrades to empty on query failure', async () => {
    const log = logger()
    const svc = createRegistryService(log, async () => {
      throw new Error('reg missing')
    })
    await expect(svc.listGuids()).resolves.toEqual([])
    await expect(svc.detail('X')).resolves.toEqual({})
    expect(log.debug).toHaveBeenCalled()
  })
})
