import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createWslConfigService,
  assertParsableWslConfig,
  WSL_CONFIG_BACKUP_KEEP,
} from '../../src/main/services/wslconfig-service'

function logger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  } as never
}

describe('WslConfigService（0.1.3 .wslconfig 读写）', () => {
  let dir = ''
  let path = ''
  let userDataDir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wslconfig-'))
    path = join(dir, '.wslconfig')
    userDataDir = join(dir, 'userData')
  })

  it('read：文件不存在 → exists:false + 空内容（视为默认配置）', async () => {
    const svc = createWslConfigService({ logger: logger(), userDataDir, path })
    const state = await svc.read()
    expect(state).toEqual({ path, exists: false, content: '' })
  })

  it('read/write 往返：原子写 + 内容一致；备份保留最近 N 份', async () => {
    const svc = createWslConfigService({ logger: logger(), userDataDir, path })
    await svc.write('[wsl2]\nmemory=8GB\n')
    expect(await readFile(path, 'utf8')).toBe('[wsl2]\nmemory=8GB\n')

    // 连续写触发备份轮转（每次写入前备份上一版）
    for (let i = 0; i < WSL_CONFIG_BACKUP_KEEP + 3; i++) {
      await svc.write(`[wsl2]\nmemory=${i + 1}GB\n`)
    }
    const backups = (await readdir(join(userDataDir, 'backups'))).filter((f) =>
      f.startsWith('wslconfig.bak.'),
    )
    expect(backups.length).toBeLessThanOrEqual(WSL_CONFIG_BACKUP_KEEP)
    expect(await readFile(path, 'utf8')).toBe(`[wsl2]\nmemory=${WSL_CONFIG_BACKUP_KEEP + 3}GB\n`)
  })

  it('write：语法守卫拒绝无法识别的行（给行号与原文）', async () => {
    const svc = createWslConfigService({ logger: logger(), userDataDir, path })
    await expect(svc.write('[wsl2]\nmemory=8GB\n???garbage\n')).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      message: expect.stringContaining('第 3 行'),
    })
    await expect(svc.write('x'.repeat(70 * 1024))).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    })
    // 首次无文件时写入不被备份失败影响（备份 ENOENT 静默）
    await svc.write('# ok\n[wsl2]\n')
    expect((await svc.read()).content).toBe('# ok\n[wsl2]\n')
  })

  it('assertParsableWslConfig：允许注释/空行/section/entry，拒绝 other 行', () => {
    expect(() => assertParsableWslConfig('# 注释\n\n[wsl2]\nmemory=1GB\n')).not.toThrow()
    expect(() => assertParsableWslConfig('just some text')).toThrow()
  })

  it('read：非 ENOENT 读取错误映射 IO_ERROR（不冒泡裸错）', async () => {
    const svc = createWslConfigService({ logger: logger(), userDataDir, path })
    const spy = vi
      .spyOn(fs, 'readFile')
      .mockRejectedValueOnce(Object.assign(new Error('EACCES: denied'), { code: 'EACCES' }))
    await expect(svc.read()).rejects.toMatchObject({ code: 'IO_ERROR' })
    spy.mockRestore()
  })
})
