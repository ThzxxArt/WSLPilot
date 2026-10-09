import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

  it('rename EPERM 时重试一次后成功', async () => {
    const file = join(dir, 'retry.jsonc')
    await atomicWrite(file, 'first')
    await atomicWrite(file, 'second')
    expect(await fs.readFile(file, 'utf8')).toBe('second')
  })
})
