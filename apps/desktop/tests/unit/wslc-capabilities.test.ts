import { describe, it, expect, vi } from 'vitest'
import {
  parseWslcHelpCapabilities,
  parseWslcVersion,
  probeWslcCapabilities,
  wslcVersionAtLeast,
} from '../../src/main/services/wslc-capabilities'

describe('wslc 能力探测纯逻辑', () => {
  it('wslcVersionAtLeast', () => {
    expect(wslcVersionAtLeast('2.9.3', '2.9.3')).toBe(true)
    expect(wslcVersionAtLeast('2.10.0', '2.9.3')).toBe(true)
    expect(wslcVersionAtLeast('3.0', '2.9.3')).toBe(true)
    expect(wslcVersionAtLeast('2.9.2', '2.9.3')).toBe(false)
    expect(wslcVersionAtLeast('2.9', '2.9.0')).toBe(true)
    expect(wslcVersionAtLeast('', '2.9.3')).toBe(false)
    expect(wslcVersionAtLeast('abc', '2.9.3')).toBe(false)
    expect(wslcVersionAtLeast('2.x.3', '2.9.3')).toBe(false)
  })

  it('parseWslcVersion：JSON / 纯文本 / 无版本', () => {
    expect(parseWslcVersion('{"version":"2.9.3"}')).toBe('2.9.3')
    expect(parseWslcVersion('wslc version 2.10.0.1')).toBe('2.10.0.1')
    expect(parseWslcVersion('no version here')).toBe('')
  })

  it('parseWslcHelpCapabilities：识别 help 中的能力与版本门槛', () => {
    const help = [
      'USAGE: wslc [OPTIONS] COMMAND',
      '  container list --format json',
      '  stats --format json',
      '  events',
      '  --health-cmd <CMD>',
      '  container restart',
      '  container cp',
      '  system info',
      '  system session list',
      '  --mount <SRC:DEST>',
      '  --gpus all',
      '  network create',
      '  volume create',
    ].join('\n')
    const caps = parseWslcHelpCapabilities(help, '2.9.3')
    expect(caps).toMatchObject({
      jsonLists: true,
      jsonStats: true,
      events: true,
      health: true,
      copy: true,
      restart: true,
      systemInfo: true,
      session: true,
      mount: true,
      gpu: true,
      networks: true,
      volumes: true,
      settingsFile: true,
    })

    const old = parseWslcHelpCapabilities('', '2.8.0')
    expect(old.settingsFile).toBe(false)
    expect(old.events).toBe(false)
  })
})

describe('probeWslcCapabilities', () => {
  const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 })

  it('版本 + 子命令 help 成功 → installed 且能力齐全', async () => {
    const help = [
      'container   image   network   volume   system   events   stats',
      'wslc run --health-cmd --health-interval --mount --gpus',
      'wslc container cp',
      'wslc container list --format (json 或 table)',
      'wslc image list --format (json 或 table)',
      'wslc network list --format (json 或 table)',
      'wslc volume list --format (json 或 table)',
      'wslc stats --format (json 或 table)',
      'wslc system info --format (json 或 table)',
      'wslc system session list',
    ].join('\n')
    const runTool = vi.fn(async (_p: string, args: string[]) =>
      args[0] === 'version' ? ok('{"version":"3.0.3.0"}') : ok(help),
    )
    const caps = await probeWslcCapabilities({ runTool: runTool as never })
    expect(caps.installed).toBe(true)
    expect(caps.version).toBe('3.0.3.0')
    expect(caps).toMatchObject({
      jsonLists: true,
      jsonStats: true,
      events: true,
      health: true,
      copy: true,
      systemInfo: true,
      session: true,
      mount: true,
      gpu: true,
      networks: true,
      volumes: true,
    })
    expect(runTool).toHaveBeenNthCalledWith(1, 'wslc.exe', ['version', '--format', 'json'], {
      timeoutMs: 10_000,
    })
  })

  it('版本命令失败且没有版本号 → installed:false（fail-soft）', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() }
    const runTool = vi.fn().mockResolvedValue({ stdout: '', stderr: 'boom', code: 1 })
    const caps = await probeWslcCapabilities({ runTool: runTool as never, logger: logger as never })
    expect(caps.installed).toBe(false)
    expect(logger.debug).toHaveBeenCalled()
  })

  it('runTool 抛错（ENOENT）→ installed:false 并记录 warn', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() }
    const runTool = vi.fn().mockRejectedValue(new Error('ENOENT'))
    const caps = await probeWslcCapabilities({ runTool: runTool as never, logger: logger as never })
    expect(caps.installed).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })
})
