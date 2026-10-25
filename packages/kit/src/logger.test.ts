import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createLogger, formatDayKey, LOG_RETENTION_MAX_BYTES } from '../src/logger'

/** 轮询等待（清理是后台异步；不用 fake timers 以免与 fs 异步互锁） */
async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await fn()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timeout')
    await new Promise((r) => setTimeout(r, 20))
  }
}

function localDayKey(at = new Date()): string {
  return `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`
}

describe('logger', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `wslpilot-log-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('writes info lines to daily log file', async () => {
    const log = createLogger(dir, 'info')
    log.info('hello', { a: 1 })
    await new Promise((r) => setTimeout(r, 50))

    const files = await fs.readdir(join(dir, 'logs'))
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^app-\d{8}\.log$/)

    const content = await fs.readFile(join(dir, 'logs', files[0]), 'utf8')
    const parsed = JSON.parse(content.trim().split('\n')[0])
    expect(parsed.level).toBe('info')
    expect(parsed.msg).toBe('hello')
    expect(parsed.a).toBe(1)
    expect(parsed.time).toBeTruthy()
  })

  it('formatDayKey 用本地时区 getter（UTC 日界会让东八区凌晨日志落错文件）', () => {
    // 用可控的「本地日期」桩：证明实现走 getFullYear/getMonth/getDate，
    // 而不是 toISOString（UTC 切片）。UTC 实现在此桩上会得到 1970/错误值。
    const localLike = {
      getFullYear: () => 2026,
      getMonth: () => 0,
      getDate: () => 2,
    } as Date
    expect(formatDayKey(localLike)).toBe('20260102')
    // 与真实 Date 的本地 getter 一致（回归：不得换成 UTC 实现）
    const now = new Date()
    const expectNow = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    expect(formatDayKey(now)).toBe(expectNow)
  })

  it('respects log level (below threshold is dropped)', async () => {
    const log = createLogger(dir, 'warn')
    log.debug('should not appear')
    log.info('should not appear')
    log.warn('warn here')
    log.error('error here')
    await new Promise((r) => setTimeout(r, 50))

    const files = await fs.readdir(join(dir, 'logs'))
    const content = await fs.readFile(join(dir, 'logs', files[0]), 'utf8')
    expect(content).not.toContain('should not appear')
    expect(content).toContain('warn here')
    expect(content).toContain('error here')
  })

  it('setLevel raises threshold dynamically', async () => {
    const log = createLogger(dir, 'info')
    log.info('first line creates log dir')
    await new Promise((r) => setTimeout(r, 30))
    log.setLevel('error')
    log.info('dropped after setLevel')
    await new Promise((r) => setTimeout(r, 30))

    const files = await fs.readdir(join(dir, 'logs'))
    const content = await fs.readFile(join(dir, 'logs', files[0]), 'utf8')
    expect(content).toContain('first line creates log dir')
    expect(content).not.toContain('dropped after setLevel')
  })

  it('supports trace/debug when level allows', async () => {
    const log = createLogger(dir, 'trace')
    log.trace('trace line')
    log.debug('debug line')
    await new Promise((r) => setTimeout(r, 50))

    const files = await fs.readdir(join(dir, 'logs'))
    const content = await fs.readFile(join(dir, 'logs', files[0]), 'utf8')
    expect(content).toContain('trace line')
    expect(content).toContain('debug line')
  })

  it('extra 不可覆盖 time/level/msg；toJSON 返回 undefined 不炸（核验修复）', async () => {
    const log = createLogger(dir, 'info')
    log.info('safe', { level: 'fake', toJSON: () => undefined } as never)
    log.info('circular', {
      get self(): unknown {
        return { self: null }
      },
    } as never)
    await new Promise((r) => setTimeout(r, 50))

    const files = await fs.readdir(join(dir, 'logs'))
    const content = await fs.readFile(join(dir, 'logs', files[0]), 'utf8')
    expect(content).toContain('"msg":"safe"')
    expect(content).toContain('"level":"info"')
  })

  it('非对象 extra 包一层 { value }（不再 spread 出 0/1 乱字段）', async () => {
    const log = createLogger(dir, 'info')
    log.info('scalar', 'oops' as never)
    log.info('num', 42 as never)
    await new Promise((r) => setTimeout(r, 50))

    const files = await fs.readdir(join(dir, 'logs'))
    const lines = (await fs.readFile(join(dir, 'logs', files[0]), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    const scalar = lines.find((l) => l.msg === 'scalar')
    const num = lines.find((l) => l.msg === 'num')
    expect(scalar.value).toBe('oops')
    expect(scalar).not.toHaveProperty('0')
    expect(num.value).toBe(42)
  })

  it('并发写单队列串行：行数与顺序完整（review 0.1.2）', async () => {
    const log = createLogger(dir, 'info')
    for (let i = 0; i < 50; i++) log.info(`m${i}`)
    await new Promise((r) => setTimeout(r, 200))

    const files = await fs.readdir(join(dir, 'logs'))
    const lines = (await fs.readFile(join(dir, 'logs', files[0]), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).msg)
    expect(lines).toEqual(Array.from({ length: 50 }, (_, i) => `m${i}`))
  })

  it('创建时清理：删超 7 天旧日志；总量超 5MB 从最旧删', async () => {
    const logs = join(dir, 'logs')
    await fs.mkdir(logs, { recursive: true })
    await fs.writeFile(join(logs, 'app-20200101.log'), 'ancient')
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayFile = join(logs, `app-${localDayKey(yesterday)}.log`)
    await fs.writeFile(yesterdayFile, Buffer.alloc(LOG_RETENTION_MAX_BYTES + 1024 * 1024))
    const todayFile = join(logs, `app-${localDayKey()}.log`)
    await fs.writeFile(todayFile, 'today')

    createLogger(dir, 'info')

    await waitUntil(async () => {
      try {
        await fs.stat(join(logs, 'app-20200101.log'))
        return false
      } catch {
        return true
      }
    })
    // 超 7 天 → 删
    await expect(fs.stat(join(logs, 'app-20200101.log'))).rejects.toThrow()
    // 总量超 5MB → 最旧的昨日日志被删，今日保留
    await waitUntil(async () => {
      try {
        await fs.stat(yesterdayFile)
        return false
      } catch {
        return true
      }
    })
    await expect(fs.stat(todayFile)).resolves.toBeTruthy()
  })

  it('总量超限时今日文件（正在写）不得被清理 — review 0.1.2 审计修复', async () => {
    const logs = join(dir, 'logs')
    await fs.mkdir(logs, { recursive: true })
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayFile = join(logs, `app-${localDayKey(yesterday)}.log`)
    await fs.writeFile(yesterdayFile, 'old')
    const todayFile = join(logs, `app-${localDayKey()}.log`)
    // 今日文件单独就超 5MB：旧实现会先删昨日、再把今日也删掉（全部日志清空）
    await fs.writeFile(todayFile, Buffer.alloc(LOG_RETENTION_MAX_BYTES + 1024))

    createLogger(dir, 'info')

    await waitUntil(async () => {
      try {
        await fs.stat(yesterdayFile)
        return false
      } catch {
        return true
      }
    })
    await expect(fs.stat(todayFile)).resolves.toBeTruthy()
  })

  it('总量超限且无今日文件时至少保留最新一天 — review 0.1.2 审计修复', async () => {
    const logs = join(dir, 'logs')
    await fs.mkdir(logs, { recursive: true })
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const olderFile = join(logs, `app-${localDayKey(twoDaysAgo)}.log`)
    const newestFile = join(logs, `app-${localDayKey(yesterday)}.log`)
    await fs.writeFile(olderFile, Buffer.alloc(1024))
    // 最新一天单独超 5MB：旧实现删完旧文件后会把最新一天也删掉（保留集清空）
    await fs.writeFile(newestFile, Buffer.alloc(LOG_RETENTION_MAX_BYTES + 1024))

    createLogger(dir, 'info')

    await waitUntil(async () => {
      try {
        await fs.stat(olderFile)
        return false
      } catch {
        return true
      }
    })
    await expect(fs.stat(newestFile)).resolves.toBeTruthy()
  })

  it('flush 等待队列落盘（退出前不丢最后一条日志）', async () => {
    const log = createLogger(dir, 'info')
    log.info('last-line-before-quit', { ok: true })
    await log.flush!()
    const text = await fs.readFile(join(dir, 'logs', `app-${localDayKey()}.log`), 'utf8')
    expect(text).toContain('last-line-before-quit')
    expect(text).toContain('"ok":true')
  })
})
