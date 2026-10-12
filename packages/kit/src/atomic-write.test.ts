import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { atomicWrite } from '../src/atomic-write'

describe('atomicWrite', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `wslpilot-test-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('writes file content', async () => {
    const file = join(dir, 'a.jsonc')
    await atomicWrite(file, '{"x":1}\n')
    expect(await fs.readFile(file, 'utf8')).toBe('{"x":1}\n')
  })

  it('creates parent directories', async () => {
    const file = join(dir, 'deep/nested/b.jsonc')
    await atomicWrite(file, 'ok')
    expect(await fs.readFile(file, 'utf8')).toBe('ok')
  })

  it('overwrites existing file atomically (no leftover tmp)', async () => {
    const file = join(dir, 'c.jsonc')
    await atomicWrite(file, 'v1')
    await atomicWrite(file, 'v2')
    expect(await fs.readFile(file, 'utf8')).toBe('v2')
    const entries = await fs.readdir(dir)
    expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0)
  })

  it('handles unicode content', async () => {
    const file = join(dir, 'u.jsonc')
    await atomicWrite(file, '{"中文":"注释"}')
    expect(await fs.readFile(file, 'utf8')).toBe('{"中文":"注释"}')
  })

  it('失败路径不留 tmp 并向上抛（review M7 回归）', async () => {
    const file = join(dir, 'sub', 'x.jsonc')
    // 目标是目录 → rename 必败
    await fs.mkdir(file, { recursive: true })
    await expect(atomicWrite(file, 'v')).rejects.toThrow()
    const entries = await fs.readdir(join(dir, 'sub'))
    expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0)
    // 目标内容未被破坏（仍是目录）
    expect((await fs.stat(file)).isDirectory()).toBe(true)
  })

  it('rename EPERM 时重试一次后成功（真实注入 EPERM — review 假信心根治）', async () => {
    const file = join(dir, 'retry.jsonc')
    const realRename = fs.rename.bind(fs)
    const spy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(
        Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }),
      )
      .mockImplementation(realRename as never)
    try {
      await atomicWrite(file, 'ok-after-retry')
      expect(await fs.readFile(file, 'utf8')).toBe('ok-after-retry')
      // 第一次 EPERM、第二次真实 rename：必须恰好重试一次
      expect(spy).toHaveBeenCalledTimes(2)
      const entries = await fs.readdir(dir)
      expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('覆盖已有文件时保留其权限 mode（review 0.1.2 根治；跨平台动态断言 — CI 修复）', async () => {
    const file = join(dir, 'mode.jsonc')
    await atomicWrite(file, 'v1')
    await fs.chmod(file, 0o600)
    // Windows 无法表达 POSIX 权限位（stat().mode 恒报 0o666/0o444，chmod 仅映射只读位）：
    // 断言「写前 == 写后」的保留语义而非硬编码 0o600 —— Linux 上 before 即 0o600，
    // 旧实现（tmp 默认权限 0o644）在此必失败
    const before = (await fs.stat(file)).mode & 0o777
    await atomicWrite(file, 'v2')
    expect(await fs.readFile(file, 'utf8')).toBe('v2')
    expect((await fs.stat(file)).mode & 0o777).toBe(before)
  })

  it('保留 mode 只取权限位 & 0o777，不复刻 setuid/setgid/sticky — review 0.1.2 审计修复', async () => {
    const file = join(dir, 'suid.jsonc')
    await atomicWrite(file, 'v1')
    await fs.chmod(file, 0o4755)
    // 动态基准：POSIX 上为 0o755（setuid 位已被 & 0o777 剥掉）；Windows 上 mode 语义受限
    const before = (await fs.stat(file)).mode & 0o777
    const realOpen = fs.open.bind(fs)
    const spy = vi.spyOn(fs, 'open').mockImplementation(realOpen as never)
    try {
      await atomicWrite(file, 'v2')
      // 旧实现把完整 stat.mode（含文件类型位与 setuid）传给 fs.open；
      // 新实现必须只传「权限位 & 0o777」——与 stat 动态一致（两端同验该契约）
      const openCall = spy.mock.calls.find((c) => String(c[0]).includes('.tmp'))
      expect(openCall).toBeTruthy()
      expect(openCall![2]).toBe(before)
    } finally {
      spy.mockRestore()
    }
    expect(await fs.readFile(file, 'utf8')).toBe('v2')
    // 写后权限位不劣化（setuid 剥除后的值保留；仅 POSIX 可断言具体位）
    if (process.platform !== 'win32') {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o755)
    }
    // setuid/setgid/sticky 位不得复刻（Windows mode 无这些位恒 0，断言两端无害）
    const st = await fs.stat(file)
    expect(st.mode & 0o7000).toBe(0)
  })

  it('EBUSY 指数退避重试 3 次后成功（50/150/450ms — review 0.1.2 根治）', async () => {
    const file = join(dir, 'busy.jsonc')
    const realRename = fs.rename.bind(fs)
    let failures = 3
    const spy = vi.spyOn(fs, 'rename').mockImplementation((async (a: never, b: never) => {
      if (failures-- > 0) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return realRename(a, b)
    }) as never)
    try {
      await atomicWrite(file, 'ok-after-backoff')
      expect(await fs.readFile(file, 'utf8')).toBe('ok-after-backoff')
      // 首次 + 3 次重试 = 4 次调用
      expect(spy).toHaveBeenCalledTimes(4)
      const entries = await fs.readdir(dir)
      expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('非 EPERM 的 rename 失败不重试，且清理 tmp 并向上抛', async () => {
    const file = join(dir, 'hard-fail.jsonc')
    const spy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' }))
    try {
      await expect(atomicWrite(file, 'v')).rejects.toThrow('ENOSPC')
      expect(spy).toHaveBeenCalledTimes(1)
      const entries = await fs.readdir(dir)
      expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
})
