import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { readBootSettings, DEFAULT_BOOT_SETTINGS } from '../../src/main/settings-boot'

describe('readBootSettings（启动早期设置）', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `wslpilot-boot-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('缺文件降级为默认（硬件加速开启）', () => {
    expect(readBootSettings(dir)).toEqual({ ...DEFAULT_BOOT_SETTINGS })
  })

  it('读取 advanced.hardwareAcceleration = false', async () => {
    await fs.writeFile(
      join(dir, 'settings.jsonc'),
      JSON.stringify({ $schemaVersion: 2, advanced: { hardwareAcceleration: false } }),
      'utf8',
    )
    expect(readBootSettings(dir)).toEqual({ hardwareAcceleration: false })
  })

  it('显式 true 保持开启', async () => {
    await fs.writeFile(
      join(dir, 'settings.jsonc'),
      JSON.stringify({ advanced: { hardwareAcceleration: true } }),
      'utf8',
    )
    expect(readBootSettings(dir).hardwareAcceleration).toBe(true)
  })

  it('损坏 JSONC / 错误类型降级为默认，绝不阻断启动', async () => {
    await fs.writeFile(join(dir, 'settings.jsonc'), '{ broken jsonc', 'utf8')
    expect(readBootSettings(dir).hardwareAcceleration).toBe(true)

    await fs.writeFile(
      join(dir, 'settings.jsonc'),
      JSON.stringify({ advanced: { hardwareAcceleration: 'yes' } }),
      'utf8',
    )
    // 非 false 一律视为开启
    expect(readBootSettings(dir).hardwareAcceleration).toBe(true)
  })

  it('支持 JSONC 注释', async () => {
    await fs.writeFile(
      join(dir, 'settings.jsonc'),
      '// comment\n{ "advanced": { "hardwareAcceleration": false } }\n',
      'utf8',
    )
    expect(readBootSettings(dir).hardwareAcceleration).toBe(false)
  })
})
