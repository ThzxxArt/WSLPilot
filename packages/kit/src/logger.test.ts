import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createLogger } from '../src/logger'

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
})
