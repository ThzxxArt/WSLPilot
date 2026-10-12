import { describe, it, expect, vi } from 'vitest'
import {
  createRegistryService,
  extractGuids,
  parseGuidDetail,
  parseGuidFull,
  collectRegValues,
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

const GUID_OUT =
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{AAAA-BBBB}\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{CCCC-DDDD}\n'
const UBUNTU =
  '    DistributionName    REG_SZ    Ubuntu\n    BasePath    REG_SZ    C:\\WSL\\Ubuntu\n    Version    REG_DWORD    0x2\n    DefaultUid    REG_DWORD    0x3e8'
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

  it('Version 缺失保留 undefined，不伪造默认 2（review 0.1.2 根治）', () => {
    const noVersion = '    DistributionName    REG_SZ    Weird\n    BasePath    REG_SZ    C:\\W'
    const d = parseGuidDetail('{X}', noVersion)
    expect(d.name).toBe('Weird')
    expect(d.version).toBeUndefined()
    const full = parseGuidFull('{X}', noVersion)
    expect(full?.version).toBeUndefined()
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

  it('查询失败不写 30s 缓存：恢复后立即重试拿真数据（review 0.1.2 根治）', async () => {
    let fail = true
    const good = makeQuery()
    const svc = createRegistryService(logger(), async (args) => {
      if (fail) throw new Error('reg transient down')
      return good(args)
    })
    await expect(svc.listGuids()).resolves.toEqual([])
    fail = false
    // 失败若被写进 30s TTL 缓存，这里仍会拿到 []（假「确无发行版」）
    await expect(svc.listGuids()).resolves.toHaveLength(2)
  })

  it('readAll single-flight：并发调用合并为一次根查询（review 0.1.2 根治）', async () => {
    const good = makeQuery()
    const q = vi.fn(async (args: string[]) => {
      await new Promise((r) => setTimeout(r, 10))
      return good(args)
    })
    const svc = createRegistryService(logger(), q)
    const [guids, all] = await Promise.all([svc.listGuids(), svc.listAll()])
    expect(guids).toHaveLength(2)
    expect(all).toHaveLength(2)
    const rootQueries = q.mock.calls.filter((c) => !String(c[0]!.join(' ')).includes('{'))
    expect(rootQueries).toHaveLength(1)
  })
})

const UBUNTU_FULL =
  '    DistributionName    REG_SZ    Ubuntu\n' +
  '    BasePath    REG_SZ    C:\\WSL\\Ubuntu\n' +
  '    Version    REG_DWORD    0x2\n' +
  '    DefaultUid    REG_DWORD    0x3e8\n' +
  '    Flags    REG_DWORD    0x7\n' +
  '    State    REG_DWORD    0x1'

describe('M5 注册表详情解析', () => {
  it('collectRegValues 收集全部键值并去引号', () => {
    const values = collectRegValues(`${UBUNTU_FULL}\n    Name    REG_SZ    "quoted"`)
    expect(values.DistributionName).toBe('Ubuntu')
    expect(values.BasePath).toBe('C:\\WSL\\Ubuntu')
    expect(values.Flags).toBe('0x7')
    expect(values.Name).toBe('quoted')
    expect(collectRegValues('nothing')).toEqual({})
  })

  it('parseGuidFull 提取 Flags 与原始键值', () => {
    const d = parseGuidFull('{AAAA}', UBUNTU_FULL)
    expect(d).toMatchObject({
      guid: '{AAAA}',
      distributionName: 'Ubuntu',
      basePath: 'C:\\WSL\\Ubuntu',
      version: 2,
      defaultUid: 1000,
      flags: 7,
    })
    expect(d!.values.State).toBe('0x1')
    expect(parseGuidFull('{X}', 'no name here')).toBeNull()
  })

  it('detailFull 返回完整详情；未找到返回 null', async () => {
    const svc = createRegistryService(logger(), makeQuery())
    const d = await svc.detailFull('Ubuntu')
    expect(d?.distributionName).toBe('Ubuntu')
    expect(d?.guid).toContain('AAAA')
    expect(d?.values.DistributionName).toBe('Ubuntu')
    await expect(svc.detailFull('Nope')).resolves.toBeNull()
  })
})
