import { describe, it, expect, vi } from 'vitest'
import {
  createWslConfService,
  assertParsableWslConf,
  summarizeWslConfChanges,
  WSL_CONF_MAX_BYTES,
} from '../../src/main/services/wslconf-service'

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

function makeRun(result: { stdout?: string; stderr?: string; code: number }) {
  return vi.fn(async () => ({
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.code,
  }))
}

describe('assertParsableWslConf', () => {
  it('接受注释 / section / 键值', () => {
    expect(() => assertParsableWslConf('# c\n[boot]\nsystemd = true\n')).not.toThrow()
    expect(() => assertParsableWslConf('')).not.toThrow()
  })

  it('拒绝无法识别的行并给出行号', () => {
    try {
      assertParsableWslConf('[boot]\n???bad\n')
      expect.unreachable()
    } catch (e: any) {
      expect(e.code).toBe('CONFIG_INVALID')
      expect(e.detail).toContain('???bad')
      expect(e.message).toContain('第 2 行')
    }
  })

  it('拒绝超大内容', () => {
    expect(() => assertParsableWslConf('x'.repeat(WSL_CONF_MAX_BYTES + 1))).toThrow()
  })
})

describe('createWslConfService.read', () => {
  it('返回 cat 输出', async () => {
    const run = makeRun({ code: 0, stdout: '[boot]\nsystemd = true\n' })
    const svc = createWslConfService({ logger: logger(), runWsl: run, runWslWithStdin: vi.fn() })
    expect(await svc.read('Ubuntu')).toContain('systemd = true')
    expect((run.mock.calls[0] as unknown as [string[]])[0]).toEqual([
      '-d',
      'Ubuntu',
      '-e',
      'cat',
      '/etc/wsl.conf',
    ])
  })

  it('文件不存在 → 空串（默认配置）', async () => {
    const run = makeRun({ code: 1, stderr: 'cat: /etc/wsl.conf: No such file or directory' })
    const svc = createWslConfService({ logger: logger(), runWsl: run, runWslWithStdin: vi.fn() })
    expect(await svc.read('Ubuntu')).toBe('')
  })

  it('其他失败 → IO_ERROR', async () => {
    const run = makeRun({ code: 1, stderr: 'permission denied' })
    const svc = createWslConfService({ logger: logger(), runWsl: run, runWslWithStdin: vi.fn() })
    await expect(svc.read('Ubuntu')).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('拒绝非法发行版名', async () => {
    const svc = createWslConfService({
      logger: logger(),
      runWsl: makeRun({ code: 0 }),
      runWslWithStdin: vi.fn(),
    })
    await expect(svc.read('bad/name')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
  })
})

describe('createWslConfService.write', () => {
  it('通过 root tee + stdin 写入', async () => {
    const runIn = makeRun({ code: 0 })
    const svc = createWslConfService({
      logger: logger(),
      runWsl: makeRun({ code: 0 }),
      runWslWithStdin: runIn,
    })
    await svc.write('Ubuntu', '[boot]\nsystemd = true\n')
    const [args, input] = runIn.mock.calls[0]! as any[]
    expect(args).toEqual(['-d', 'Ubuntu', '-u', 'root', '-e', 'tee', '/etc/wsl.conf'])
    expect(input).toContain('systemd = true')
  })

  it('语法非法拒绝写入', async () => {
    const runIn = makeRun({ code: 0 })
    const svc = createWslConfService({
      logger: logger(),
      runWsl: makeRun({ code: 0 }),
      runWslWithStdin: runIn,
    })
    await expect(svc.write('Ubuntu', '???bad')).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    expect(runIn).not.toHaveBeenCalled()
  })

  it('权限失败 → PERMISSION_DENIED', async () => {
    const runIn = makeRun({ code: 1, stderr: 'tee: /etc/wsl.conf: Permission denied' })
    const svc = createWslConfService({
      logger: logger(),
      runWsl: makeRun({ code: 0 }),
      runWslWithStdin: runIn,
    })
    await expect(svc.write('Ubuntu', '[a]\nb = 1\n')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
  })

  it('其他失败 → IO_ERROR', async () => {
    const runIn = makeRun({ code: 1, stderr: 'disk full' })
    const svc = createWslConfService({
      logger: logger(),
      runWsl: makeRun({ code: 0 }),
      runWslWithStdin: runIn,
    })
    await expect(svc.write('Ubuntu', '[a]\nb = 1\n')).rejects.toMatchObject({ code: 'IO_ERROR' })
  })
})

describe('summarizeWslConfChanges', () => {
  it('汇总修改/删除数量', () => {
    expect(summarizeWslConfChanges([])).toBe('无变更')
    expect(
      summarizeWslConfChanges([
        { section: 'a', key: 'b', after: '1', kind: 'set' },
        { section: 'a', key: 'c', kind: 'remove' },
      ]),
    ).toBe('1 项修改 · 1 项删除')
  })
})
