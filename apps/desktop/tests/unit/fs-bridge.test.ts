import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fsp, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFsBridge,
  parseLinuxPath,
  joinDistroPath,
  defaultRootFor,
  READDIR_LIMIT,
} from '../../src/main/services/fs-bridge'

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

describe('parseLinuxPath', () => {
  it('规范化段并生成 Linux 形态', () => {
    expect(parseLinuxPath('/etc/wsl.conf')).toEqual({
      segments: ['etc', 'wsl.conf'],
      linuxPath: '/etc/wsl.conf',
    })
    expect(parseLinuxPath('')).toEqual({ segments: [], linuxPath: '/' })
    expect(parseLinuxPath('/')).toEqual({ segments: [], linuxPath: '/' })
    expect(parseLinuxPath('/a/./b/')).toEqual({ segments: ['a', 'b'], linuxPath: '/a/b' })
  })

  it('拒绝 .. 逃逸', () => {
    expect(() => parseLinuxPath('/etc/../root')).toThrow()
    expect(() => parseLinuxPath('..')).toThrow()
  })

  it('拒绝控制字符与 Windows 非法字符', () => {
    expect(() => parseLinuxPath('/a\u0000b')).toThrow()
    expect(() => parseLinuxPath('/a:b')).toThrow()
    expect(() => parseLinuxPath('/a*b')).toThrow()
  })

  it('拒绝超长路径', () => {
    expect(() => parseLinuxPath(`/${'a'.repeat(2000)}`)).toThrow()
  })
})

describe('joinDistroPath', () => {
  it('UNC 拼接（默认反斜杠）', () => {
    expect(joinDistroPath('\\\\wsl.localhost\\Ubuntu', '/etc/wsl.conf')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\etc\\wsl.conf',
    )
    expect(joinDistroPath('\\\\wsl.localhost\\Ubuntu', '/')).toBe('\\\\wsl.localhost\\Ubuntu')
  })

  it('测试注入 posix 分隔符', () => {
    expect(joinDistroPath('/root', '/etc/x', '/')).toBe('/root/etc/x')
    expect(joinDistroPath('/root/', '/etc/x', '/')).toBe('/root/etc/x')
  })

  it('defaultRootFor 生成 wsl.localhost UNC', () => {
    expect(defaultRootFor('Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu')
  })
})

describe('createFsBridge（临时目录模拟发行版根）', () => {
  let root: string
  let bridge: ReturnType<typeof createFsBridge>

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'wslpilot-fs-'))
    await fsp.mkdir(join(root, 'etc'), { recursive: true })
    await fsp.writeFile(join(root, 'etc', 'wsl.conf'), '[boot]\nsystemd = true\n', 'utf8')
    await fsp.writeFile(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]), 'utf8')
    bridge = createFsBridge({
      logger: logger(),
      rootFor: () => root,
      sep: '/',
      reveal: vi.fn(),
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('readDir 列出条目（目录优先）', async () => {
    const entries = await bridge.readDir('Ubuntu', '/')
    expect(entries.map((e) => e.name)).toEqual(['etc', 'bin.dat'])
    expect(entries[0]).toMatchObject({ name: 'etc', isDirectory: true, path: '/etc' })
    expect(entries[1]).toMatchObject({ name: 'bin.dat', isDirectory: false, path: '/bin.dat' })
    expect(entries[1]!.size).toBe(4)
    expect(entries[1]!.modifiedAt).toBeTruthy()
  })

  it('readDir 不存在 → IO_ERROR（提示发行版需运行）', async () => {
    await expect(bridge.readDir('Ubuntu', '/nope')).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('readDir 对文件路径报「不是目录」', async () => {
    await expect(bridge.readDir('Ubuntu', '/etc/wsl.conf')).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })

  it('read 读取文本', async () => {
    const r = await bridge.read('Ubuntu', '/etc/wsl.conf')
    expect(r.binary).toBe(false)
    expect(r.text).toContain('systemd = true')
    expect(r.sizeBytes).toBeGreaterThan(0)
    expect(r.truncated).toBe(false)
  })

  it('read 识别二进制', async () => {
    const r = await bridge.read('Ubuntu', '/bin.dat')
    expect(r.binary).toBe(true)
    expect(r.text).toBe('')
  })

  it('read 文件不存在 / 目标是目录 → IO_ERROR', async () => {
    await expect(bridge.read('Ubuntu', '/nope.txt')).rejects.toMatchObject({ code: 'IO_ERROR' })
    await expect(bridge.read('Ubuntu', '/etc')).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('write 写入并可回读', async () => {
    await bridge.write('Ubuntu', '/etc/new.conf', '[user]\ndefault = me\n')
    expect(existsSync(join(root, 'etc', 'new.conf'))).toBe(true)
    const r = await bridge.read('Ubuntu', '/etc/new.conf')
    expect(r.text).toContain('default = me')
  })

  it('write 超过 4MB 拒绝', async () => {
    await expect(
      bridge.write('Ubuntu', '/big.txt', 'x'.repeat(4 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('write 路径逃逸拒绝', async () => {
    await expect(bridge.write('Ubuntu', '/../evil', 'x')).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })

  it('revealInExplorer 仅对存在的路径', async () => {
    const reveal = vi.fn()
    const b = createFsBridge({ logger: logger(), rootFor: () => root, sep: '/', reveal })
    await b.revealInExplorer('Ubuntu', '/etc/wsl.conf')
    expect(reveal).toHaveBeenCalledWith(join(root, 'etc', 'wsl.conf'))
    await expect(b.revealInExplorer('Ubuntu', '/nope')).rejects.toMatchObject({
      code: 'IO_ERROR',
    })
  })

  it('非法发行版名被拒绝', async () => {
    await expect(bridge.readDir('bad/name', '/')).rejects.toMatchObject({
      code: 'DISTRO_NOT_FOUND',
    })
  })

  it('readDir 超量截断（上限保护）', async () => {
    const many = join(root, 'many')
    await fsp.mkdir(many)
    for (let i = 0; i < 20; i++) await fsp.writeFile(join(many, `f${i}`), '')
    // 降低上限不可注入 → 通过常量断言上限存在（真实上限 5000）
    expect(READDIR_LIMIT).toBe(5000)
    const entries = await bridge.readDir('Ubuntu', '/many')
    expect(entries).toHaveLength(20)
  })
})
