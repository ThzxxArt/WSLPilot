import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@wslpilot/kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wslpilot/kit')>()
  return {
    ...actual,
    runWsl: vi.fn(),
    spawnWsl: vi.fn(),
  }
})

import {
  createWslService,
  normalizeState,
  listContainsDistro,
} from '../../src/main/services/wsl-service'
import { runWsl, spawnWsl } from '@wslpilot/kit'

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

function ok(stdout: string) {
  return { stdout, stderr: '', code: 0 }
}

describe('normalizeState', () => {
  it('maps English and Chinese state strings', () => {
    expect(normalizeState('Running')).toBe('Running')
    expect(normalizeState('Stopped')).toBe('Stopped')
    expect(normalizeState('正在运行')).toBe('Running')
    expect(normalizeState('已停止')).toBe('Stopped')
    expect(normalizeState('Installing')).toBe('Installing')
    expect(normalizeState('')).toBe('Unknown')
    expect(normalizeState('weird')).toBe('Unknown')
  })
})

describe('listContainsDistro（精确名单匹配 — 拒绝前缀误判）', () => {
  const verbose = 'NAME STATE VERSION\r\n* Ubuntu-22.04  Running  2\r\n  Debian  Stopped  1'
  const simpleEn = 'Windows Subsystem for Linux Distributions:\nUbuntu-22.04 (Default)\nDebian\n'
  const simpleZh = '适用于 Linux 的 Windows 子系统分发版:\nUbuntu-22.04（默认）\nDebian\n'

  it('verbose 表格：精确命中（大小写不敏感）', () => {
    expect(listContainsDistro(verbose, 'Ubuntu-22.04')).toBe(true)
    expect(listContainsDistro(verbose, 'ubuntu-22.04')).toBe(true)
    expect(listContainsDistro(verbose, '  Debian  ')).toBe(true)
  })

  it('真实 `wsl --list` 简单列表（(Default)/(默认) 后缀）：精确命中', () => {
    expect(listContainsDistro(simpleEn, 'Ubuntu-22.04')).toBe(true)
    expect(listContainsDistro(simpleEn, 'ubuntu-22.04')).toBe(true)
    expect(listContainsDistro(simpleEn, 'Debian')).toBe(true)
    expect(listContainsDistro(simpleZh, 'Ubuntu-22.04')).toBe(true)
    expect(listContainsDistro(simpleZh, 'debian')).toBe(true)
  })

  it('前缀不误判：Ubuntu-22.04 在列 ≠ Ubuntu 已装（两种形态）', () => {
    expect(listContainsDistro(verbose, 'Ubuntu')).toBe(false)
    expect(listContainsDistro(verbose, 'ubuntu')).toBe(false)
    expect(listContainsDistro(simpleEn, 'Ubuntu')).toBe(false)
    expect(listContainsDistro(simpleZh, 'Ubuntu')).toBe(false)
  })

  it('空目标 / 未注册返回 false', () => {
    expect(listContainsDistro(verbose, '')).toBe(false)
    expect(listContainsDistro(verbose, 'Arch')).toBe(false)
    expect(listContainsDistro('NAME STATE VERSION', 'Ubuntu')).toBe(false)
    expect(listContainsDistro(simpleEn, 'Arch')).toBe(false)
  })
})

describe('WslService', () => {
  const svc = createWslService(logger())

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('list', () => {
    it('parses verbose list', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok(
          '  NAME            STATE           VERSION\r\n* Ubuntu-22.04    Running         2\r\n  Debian          Stopped         1',
        ),
      )
      const list = await svc.list()
      expect(list).toHaveLength(2)
      expect(list[0]).toMatchObject({
        name: 'Ubuntu-22.04',
        state: 'Running',
        version: 2,
        isDefault: true,
      })
      expect(list[1]).toMatchObject({ name: 'Debian', version: 1, isDefault: false })
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--list', '--verbose'])
    })

    it('throws WSL_NOT_FOUND when wsl.exe missing', async () => {
      ;(runWsl as any).mockResolvedValue({
        stdout: '',
        stderr: "'wsl.exe' is not recognized",
        code: 1,
      })
      await expect(svc.list()).rejects.toMatchObject({ code: 'WSL_NOT_FOUND' })
    })

    it('throws WSL_NOT_INSTALLED when WSL disabled', async () => {
      ;(runWsl as any).mockResolvedValue({
        stdout: '',
        stderr: 'Windows Subsystem for Linux is not installed',
        code: 1,
      })
      await expect(svc.list()).rejects.toMatchObject({ code: 'WSL_NOT_INSTALLED' })
    })

    it('throws TASK_FAILED for other errors', async () => {
      ;(runWsl as any).mockResolvedValue({ stdout: '', stderr: 'boom', code: 3 })
      await expect(svc.list()).rejects.toMatchObject({ code: 'TASK_FAILED' })
    })
  })

  describe('listWithMeta', () => {
    it('merges meta from map and fills defaults', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok('NAME STATE VERSION\n* Ubuntu  Running  2\n  Alpine  Stopped  2'),
      )
      const meta = new Map([
        [
          'Ubuntu',
          {
            name: 'Ubuntu',
            alias: '主力',
            tags: ['work'],
            color: '#E95420',
            icon: 'ubuntu',
            note: '',
            startupCwd: '~',
            pinned: true,
            quickActions: [],
          },
        ],
      ])
      const views = await svc.listWithMeta(meta)
      expect(views[0]!.meta?.alias).toBe('主力')
      expect(views[1]!.meta?.alias).toBe('')
      expect(views[1]!.meta?.name).toBe('Alpine')
    })

    it('meta 键大小写不一致仍命中（不静默丢元数据 — review 根治）', async () => {
      ;(runWsl as any).mockResolvedValue(ok('NAME STATE VERSION\n* UBUNTU  Running  2'))
      const meta = new Map([
        [
          'ubuntu',
          {
            name: 'ubuntu',
            alias: '主力',
            tags: ['work'],
            color: '#E95420',
            icon: 'ubuntu',
            note: '',
            startupCwd: '/home/me',
            pinned: true,
            quickActions: [],
          },
        ],
      ])
      const views = await svc.listWithMeta(meta)
      expect(views[0]!.meta?.alias).toBe('主力')
      expect(views[0]!.meta?.pinned).toBe(true)
    })
  })

  describe('start / terminate / shutdown / setDefault', () => {
    it('start uses -d name -e true', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.start('Ubuntu-22.04')
      expect((runWsl as any).mock.calls[0][0]).toEqual(['-d', 'Ubuntu-22.04', '-e', 'true'])
    })

    it('assertRunning：未运行/不存在拒绝，运行中放行（review 隐式启动根治）', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok(
          '  NAME            STATE           VERSION\r\n* Ubuntu-22.04    Running         2\r\n  Debian          Stopped         1',
        ),
      )
      await expect(svc.assertRunning('Ubuntu-22.04')).resolves.toBeUndefined()
      await expect(svc.assertRunning('Debian')).rejects.toMatchObject({
        code: 'DISTRO_NOT_RUNNING',
      })
      await expect(svc.assertRunning('Nope')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })

    it('terminate uses --terminate', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.terminate('Debian')
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--terminate', 'Debian'])
    })

    it('shutdown uses --shutdown', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.shutdown()
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--shutdown'])
    })

    it('setDefault uses --set-default', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.setDefault('Ubuntu')
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--set-default', 'Ubuntu'])
    })

    it('rejects empty name', async () => {
      await expect(svc.start('  ')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })

    it('rejects path-like name', async () => {
      await expect(svc.terminate('../etc')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })

    it('rejects control characters and path traversal', async () => {
      await expect(svc.start('bad\nname')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
      await expect(svc.start('bad\0name')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
      await expect(svc.terminate('..')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
      await expect(svc.setDefault('a/../b')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })

    it('allows spaces and unicode in real WSL names', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await expect(svc.start('Ubuntu 22.04 LTS')).resolves.toBeUndefined()
      await expect(svc.start('测试发行版')).resolves.toBeUndefined()
    })

    it('propagates DISTRO_NOT_FOUND on failure', async () => {
      ;(runWsl as any).mockResolvedValue({
        stdout: '',
        stderr: 'Error: not found',
        code: 1,
      })
      await expect(svc.start('Nope')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })
  })

  describe('getVersion', () => {
    it('extracts wsl and kernel versions', async () => {
      ;(runWsl as any)
        .mockResolvedValueOnce(ok('WSL version: 2.3.26\r\nKernel version: 5.15.153.1'))
        .mockResolvedValueOnce(ok('OK'))
      const v = await svc.getVersion()
      expect(v.wslVersion).toBe('2.3.26')
      expect(v.kernelVersion).toContain('5.15')
    })

    it('双命令都失败时抛 TASK_FAILED（不装成功返回空串）', async () => {
      ;(runWsl as any)
        .mockResolvedValueOnce({ stdout: '', stderr: 'wsl missing', code: 1 })
        .mockResolvedValueOnce({ stdout: '', stderr: 'wsl missing', code: 1 })
      await expect(svc.getVersion()).rejects.toMatchObject({
        code: 'TASK_FAILED',
        message: '无法获取 WSL 版本',
        suggestion: expect.stringContaining('wsl --update'),
      })
    })

    it('一成功一失败 → 保持现状返回 raw/空串（log warn）', async () => {
      ;(runWsl as any)
        .mockResolvedValueOnce({ stdout: '', stderr: 'no --version', code: 1 })
        .mockResolvedValueOnce(ok('Kernel version: 5.15.153.1'))
      const v = await svc.getVersion()
      expect(v.wslVersion).toBe('')
      expect(v.kernelVersion).toContain('5.15')
      expect(v.raw).toContain('5.15')
    })
  })

  describe('sampleMetrics', () => {
    it('parses MEM:/DISK: 标签行与 /proc/stat 差分 CPU（review M17/M18）', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok(
          [
            'MEM:4194304 812345',
            'DISK:263168000 12884900',
            'cpu  100 0 100 800 0 0 0 0 0 0',
            'cpu  150 0 150 850 0 0 0 0 0 0',
          ].join('\n'),
        ),
      )
      const m = await svc.sampleMetrics('Ubuntu')
      expect(m.memTotalKB).toBe(4194304)
      expect(m.memUsedKB).toBe(812345)
      expect(m.diskUsedKB).toBe(263168000)
      expect(m.diskTotalKB).toBe(12884900)
      // (150-50)/150 = 66.7%
      expect(m.cpuPercent).toBe(66.7)
      expect(m.sampledAt).toBeTruthy()
    })

    it('缺 /proc/stat 样本时 CPU 为 0，不用负载伪造', async () => {
      ;(runWsl as any).mockResolvedValue(ok('MEM:100 50\nDISK:1 2\n'))
      const m = await svc.sampleMetrics('Ubuntu')
      expect(m.cpuPercent).toBe(0)
      expect(m.memTotalKB).toBe(100)
    })

    it('命令失败抛 TASK_FAILED（零值假成功会污染 CPU 分母，禁止）', async () => {
      ;(runWsl as any).mockResolvedValue({ stdout: '', stderr: 'boom', code: 1 })
      await expect(svc.sampleMetrics('Ubuntu')).rejects.toMatchObject({
        code: 'TASK_FAILED',
        message: expect.stringContaining('采样'),
        detail: expect.stringContaining('boom'),
      })
    })

    it('命令成功但解析不出可信数据（无 MEM/DISK 行）同样抛错，不静默零值', async () => {
      ;(runWsl as any).mockResolvedValue(ok('some garbage output'))
      await expect(svc.sampleMetrics('Ubuntu')).rejects.toMatchObject({
        code: 'TASK_FAILED',
        message: expect.stringContaining('无可信数据'),
      })
    })

    it('仅缺 DISK（mem 可信）不抛错，部分数据照常返回', async () => {
      ;(runWsl as any).mockResolvedValue(ok('MEM:100 50\n'))
      const m = await svc.sampleMetrics('Ubuntu')
      expect(m.memTotalKB).toBe(100)
      expect(m.diskTotalKB).toBe(0)
    })

    it('rejects empty name', async () => {
      await expect(svc.sampleMetrics('')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })
  })

  describe('listOnline / install / unregister / setVersion', () => {
    const ctl = {
      taskId: 't',
      type: 'install' as const,
      report: vi.fn(),
      log: vi.fn(),
      isCanceled: () => false,
      throwIfCanceled: () => {},
      onCancel: vi.fn(),
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('listOnline 解析名字列并跳过表头（含友好名 — 0.1.3）', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok(
          'NAME            FRIENDLY NAME\nUbuntu          Ubuntu\nDebian          Debian GNU/Linux',
        ),
      )
      expect(await svc.listOnline()).toEqual([
        { name: 'Ubuntu', friendlyName: 'Ubuntu' },
        { name: 'Debian', friendlyName: 'Debian GNU/Linux' },
      ])
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--list', '--online'])
    })

    it('listOnline 支持中文表头与前置说明行（review m2 分支覆盖）', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok(
          '以下是可安装的发行版的列表。\n名称            友好名称\nUbuntu          Ubuntu\nAlpine          Alpine WSL',
        ),
      )
      expect(await svc.listOnline()).toEqual([
        { name: 'Ubuntu', friendlyName: 'Ubuntu' },
        { name: 'Alpine', friendlyName: 'Alpine WSL' },
      ])
    })

    it('listOnline 友好名缺失时回退为 name（绝不空标签 — 0.1.3）', async () => {
      ;(runWsl as any).mockResolvedValue(ok('NAME\nUbuntu\nDebian'))
      expect(await svc.listOnline()).toEqual([
        { name: 'Ubuntu', friendlyName: 'Ubuntu' },
        { name: 'Debian', friendlyName: 'Debian' },
      ])
    })

    it('listOnline 失败抛 TASK_FAILED', async () => {
      ;(runWsl as any).mockResolvedValue({ stdout: '', stderr: 'net fail', code: 1 })
      await expect(svc.listOnline()).rejects.toMatchObject({ code: 'TASK_FAILED' })
    })

    it('install 走流式任务并支持省略名称（--no-launch 装完即退 — review 根治）', async () => {
      // 异步 onExit：对齐真实 spawn 的事件序（同步触发会掩盖 kill/exit 交错 — review m1）
      ;(spawnWsl as any).mockImplementation((_a: string[], o: { onExit: (c: number) => void }) => {
        queueMicrotask(() => o.onExit(0))
        return { kill: vi.fn() }
      })
      await svc.install('Ubuntu', ctl as never)
      expect((spawnWsl as any).mock.calls[0][0]).toEqual([
        '--install',
        '-d',
        'Ubuntu',
        '--no-launch',
      ])
      await svc.install(undefined, ctl as never)
      expect((spawnWsl as any).mock.calls[1][0]).toEqual(['--install', '--no-launch'])
    })

    it('install 完成判定：进程挂住不退但发行版已注册 → 任务结算成功（review「永远进行中」根治）', async () => {
      // wsl --install 装完拉起首启会话挂住：onExit 永不触发
      ;(spawnWsl as any).mockImplementation(() => ({ kill: vi.fn() }))
      // 真实 `wsl --list`（非 verbose）输出形态：Ubuntu (默认)
      let listCalls = 0
      ;(runWsl as any).mockImplementation(async (args: string[]) => {
        if (args[0] === '--list') {
          listCalls++
          return listCalls === 1
            ? ok('适用于 Linux 的 Windows 子系统分发版:')
            : ok('适用于 Linux 的 Windows 子系统分发版:\nUbuntu (默认)')
        }
        return { stdout: '', stderr: '', code: 0 }
      })
      const started = Date.now()
      await svc.install('Ubuntu', ctl as never)
      // 4s 轮询周期内收敛（未无限等待）
      expect(Date.now() - started).toBeLessThan(15_000)
      const reports = (ctl.report.mock as { calls: unknown[][] }).calls
      expect(reports[reports.length - 1]).toEqual([100, '安装完成'])
      // review 0.1.2：本用例依赖真实 4s 轮询时钟（服务实现内固定 4000ms，测试不可注入），
      // 默认 5s 超时在 CI 负载下会假超时 —— 显式放宽到 15s，防抖动不放松断言
    }, 15_000)

    it('install 前缀碰撞：只有 Ubuntu-22.04 在列时不判 Ubuntu 已装，直到进程真正退出', async () => {
      ;(spawnWsl as any).mockImplementation((_a: string[], o: { onExit: (c: number) => void }) => {
        // 进程挂住一轮轮询（4s）后模拟真实退出：期间前缀相似项不得触发结算
        setTimeout(() => o.onExit(0), 4200)
        return { kill: vi.fn() }
      })
      ;(runWsl as any).mockImplementation(async (args: string[]) => {
        if (args[0] === '--list') {
          // 真实简单列表形态（中文默认后缀）
          return ok('适用于 Linux 的 Windows 子系统分发版:\nUbuntu-22.04（默认）')
        }
        return { stdout: '', stderr: '', code: 0 }
      })
      const logs: string[] = []
      const ctl2 = { ...ctl, report: vi.fn(), log: (l: string) => logs.push(l) }
      await svc.install('Ubuntu', ctl2 as never)
      // 全程不得出现「已注册」假结算
      expect(logs.some((l) => l.includes('已注册'))).toBe(false)
      const reports = (ctl2.report.mock as { calls: unknown[][] }).calls
      expect(reports[reports.length - 1]).toEqual([100, '安装完成'])
      // review 0.1.2：依赖真实 4s 轮询 + 4.2s 模拟退出（服务内固定时钟，测试不可注入），
      // 显式 15s 超时防 CI 抖动；结算语义断言保持不放宽
    }, 15_000)

    it('install 装前已存在（精确命中）：注册信号不启用，等待进程退出结算', async () => {
      let captured: { onExit: (c: number) => void } | null = null
      ;(spawnWsl as any).mockImplementation((_a: string[], o: { onExit: (c: number) => void }) => {
        captured = o
        setTimeout(() => o.onExit(0), 30)
        return { kill: vi.fn() }
      })
      // 基线即精确存在：不得把「已存在」当完成信号提前结算
      ;(runWsl as any).mockImplementation(async (args: string[]) => {
        if (args[0] === '--list') {
          // 真实简单列表形态（英文默认后缀）
          return ok('Windows Subsystem for Linux Distributions:\nUbuntu (Default)')
        }
        return { stdout: '', stderr: '', code: 0 }
      })
      const logs: string[] = []
      const ctl2 = { ...ctl, report: vi.fn(), log: (l: string) => logs.push(l) }
      await svc.install('Ubuntu', ctl2 as never)
      expect(captured).not.toBeNull()
      expect(logs.some((l) => l.includes('已注册'))).toBe(false)
      const reports = (ctl2.report.mock as { calls: unknown[][] }).calls
      expect(reports[reports.length - 1]).toEqual([100, '安装完成'])
    })

    it('install 对老 WSL 的 --no-launch 不识别自动降级（标准参数重试后成功）', async () => {
      ;(spawnWsl as any).mockImplementation(
        (_a: string[], o: { onLine: (l: string) => void; onExit: (c: number) => void }) => {
          const n = (spawnWsl as any).mock.calls.length
          if (n === 1) {
            o.onLine('Invalid command line option: --no-launch')
            queueMicrotask(() => o.onExit(1))
          } else {
            queueMicrotask(() => o.onExit(0))
          }
          return { kill: vi.fn() }
        },
      )
      await svc.install('Ubuntu', ctl as never)
      const calls = (spawnWsl as any).mock.calls.map((c: unknown[]) => c[0])
      expect(calls[0]).toContain('--no-launch')
      expect(calls[1]).toEqual(['--install', '-d', 'Ubuntu'])
      const reports = (ctl.report.mock as { calls: unknown[][] }).calls
      expect(reports[reports.length - 1]).toEqual([100, '安装完成'])
    })

    it('install 进度诚实：null 起手（不假 0%）+ 输出百分比如实上报（review 根治）', async () => {
      ;(spawnWsl as any).mockImplementation(
        (_a: string[], o: { onLine: (l: string) => void; onExit: (c: number) => void }) => {
          o.onLine('Downloading: 42.5%')
          o.onLine('没有百分比的普通日志')
          o.onLine('Downloading: 100%')
          queueMicrotask(() => o.onExit(0))
          return { kill: vi.fn() }
        },
      )
      const reports = ctl.report.mock
      await svc.install('Ubuntu', ctl as never)
      const calls = reports.calls.map((c: unknown[]) => c[0])
      // 起手必须是 null（不确定态），绝不报 0 假进度
      expect(calls[0]).toBeNull()
      // 输出中的真实百分比被上报
      expect(calls).toContain(42.5)
      expect(calls).toContain(100)
      // 收尾 100 + 完成文案
      expect(reports.calls[reports.calls.length - 1]).toEqual([100, '安装完成'])
    })

    it('unregister 调用 --unregister', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.unregister('Ubuntu')
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--unregister', 'Ubuntu'])
    })

    it('install 输出含「重启」提示：完成文案如实标注（0.1.3）', async () => {
      ;(spawnWsl as any).mockImplementation(
        (_a: string[], o: { onLine: (l: string) => void; onExit: (c: number) => void }) => {
          o.onLine(
            'The requested operation is successful. Changes will not be effective until the system is rebooted.',
          )
          queueMicrotask(() => o.onExit(0))
          return { kill: vi.fn() }
        },
      )
      const reports: Array<[unknown, unknown]> = []
      const ctl2 = {
        ...ctl,
        report: vi.fn((p: unknown, m?: string) => reports.push([p, m])),
        log: vi.fn(),
      }
      await svc.install(undefined, ctl2 as never)
      const final = reports[reports.length - 1] as [number, string]
      expect(final[0]).toBe(100)
      expect(final[1]).toContain('需要重启')
      expect(
        (ctl2.log as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
          String(c[0]).includes('需要重启'),
        ),
      ).toBe(true)
    })

    it('setVersion 流式转换', async () => {
      ;(spawnWsl as any).mockImplementation((_a: string[], o: { onExit: (c: number) => void }) => {
        queueMicrotask(() => o.onExit(0))
        return { kill: vi.fn() }
      })
      await svc.setVersion('Ubuntu', 2, ctl as never)
      expect((spawnWsl as any).mock.calls[0][0]).toEqual(['--set-version', 'Ubuntu', '2'])
    })
  })

  it('list 映射 spawn ENOENT 到 WSL_NOT_FOUND（review M6）', async () => {
    ;(runWsl as any).mockResolvedValue({
      stdout: '',
      stderr: 'spawn wsl.exe ENOENT',
      code: -1,
    })
    await expect(svc.list()).rejects.toMatchObject({ code: 'WSL_NOT_FOUND' })
  })
})

describe('parseWslStatus（0.1.3 环境体检）', () => {
  it('英文输出：默认发行版/默认版本/内核版本', async () => {
    const { parseWslStatus } = await import('../../src/main/services/wsl-service')
    const out = parseWslStatus(
      [
        'Default Distribution: Ubuntu',
        'Default Version: 2',
        '',
        'Kernel version: 5.15.153.1-2',
      ].join('\n'),
    )
    expect(out).toEqual({
      defaultDistro: 'Ubuntu',
      defaultVersion: 2,
      kernelVersion: '5.15.153.1-2',
    })
  })

  it('中文输出 + 无法解析字段如实为空（不伪造）', async () => {
    const { parseWslStatus } = await import('../../src/main/services/wsl-service')
    const out = parseWslStatus('默认分发: Debian\n默认版本: 1\n内核版本: 6.6.87.2-1')
    expect(out).toEqual({
      defaultDistro: 'Debian',
      defaultVersion: 1,
      kernelVersion: '6.6.87.2-1',
    })
    const empty = parseWslStatus('随便什么输出')
    expect(empty).toEqual({ defaultDistro: '', defaultVersion: null, kernelVersion: '' })
  })
})

describe('WslService 0.1.3（getEnv / update / rollback / setDefaultVersion / setSparse）', () => {
  const svc = createWslService(logger())
  const ctl = {
    taskId: 't',
    type: 'update' as const,
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: () => {},
    onCancel: vi.fn(),
  }

  beforeEach(() => vi.clearAllMocks())

  it('getEnv：双命令失败 → installed:false + 原始输出（不抛）', async () => {
    ;(runWsl as any)
      .mockResolvedValueOnce({ stdout: '', stderr: 'wsl 缺失', code: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'wsl 缺失', code: 1 })
    const env = await svc.getEnv()
    expect(env.installed).toBe(false)
    expect(env.statusRaw).toContain('wsl 缺失')
    expect(env.defaultVersion).toBeNull()
  })

  it('getEnv：已安装 → 版本/内核/默认项全量解析', async () => {
    ;(runWsl as any)
      .mockResolvedValueOnce(ok('WSL version: 2.6.1\nKernel version: 6.6.87.2-1'))
      .mockResolvedValueOnce(ok('默认分发: Ubuntu\n默认版本: 2\n'))
    const env = await svc.getEnv()
    expect(env).toMatchObject({
      installed: true,
      wslVersion: '2.6.1',
      kernelVersion: '6.6.87.2-1',
      defaultDistro: 'Ubuntu',
      defaultVersion: 2,
    })
  })

  it('update：前后版本对比 + 真实百分比日志 + 需要重启提示（如实报告）', async () => {
    ;(runWsl as any)
      .mockResolvedValueOnce(ok('WSL version: 2.3.0')) // before
      .mockResolvedValueOnce(ok('WSL version: 2.4.0')) // after
    ;(spawnWsl as any).mockImplementation(
      (_a: string[], o: { onLine: (l: string) => void; onExit: (c: number) => void }) => {
        o.onLine('Downloading: 42%')
        o.onLine('Restart your computer to finish the update')
        queueMicrotask(() => o.onExit(0))
        return { kill: vi.fn() }
      },
    )
    const reports: Array<[unknown, unknown]> = []
    const ctl2 = { ...ctl, report: vi.fn((p: unknown, m?: string) => reports.push([p, m])) }
    await svc.update(ctl2 as never, { preRelease: true })
    expect((spawnWsl as any).mock.calls[0][0]).toEqual(['--update', '--pre-release'])
    const final = reports[reports.length - 1] as [number, string]
    expect(final[0]).toBe(100)
    expect(final[1]).toContain('2.3.0 → 2.4.0')
    expect(final[1]).toContain('需要重启')
  })

  it('update：版本未变化时如实报告「已是最新/无可用更新」措辞', async () => {
    ;(runWsl as any)
      .mockResolvedValueOnce(ok('WSL version: 2.4.0'))
      .mockResolvedValueOnce(ok('WSL version: 2.4.0'))
    ;(spawnWsl as any).mockImplementation((_a: string[], o: { onExit: (c: number) => void }) => {
      queueMicrotask(() => o.onExit(0))
      return { kill: vi.fn() }
    })
    const reports: Array<[unknown, unknown]> = []
    const ctl2 = { ...ctl, report: vi.fn((p: unknown, m?: string) => reports.push([p, m])) }
    await svc.update(ctl2 as never)
    const final = reports[reports.length - 1] as [number, string]
    expect(final[1]).toContain('2.4.0')
    expect(final[1]).not.toContain('→')
  })

  it('updateRollback：argv 与提权委托', async () => {
    ;(spawnWsl as any).mockImplementation(
      (_a: string[], o: { onLine: (l: string) => void; onExit: (c: number) => void }) => {
        o.onLine('The requested operation requires elevation')
        o.onExit(1)
        return { kill: vi.fn() }
      },
    )
    const runOne = vi.fn(async () => ({
      op: 'wsl.updateRollback' as const,
      ok: true,
      code: 0,
      stdout: '',
      stderr: '',
    }))
    const svc2 = createWslService(logger(), { elevation: { runOne } as never })
    await svc2.updateRollback(ctl as never)
    expect(runOne).toHaveBeenCalledWith({ op: 'wsl.updateRollback', params: {} })
  })

  it('setDefaultVersion：直接成功；权限不足转提权；其他失败映射 TASK_FAILED', async () => {
    ;(runWsl as any).mockResolvedValueOnce(ok(''))
    await expect(svc.setDefaultVersion(2)).resolves.toBeUndefined()
    expect((runWsl as any).mock.calls[0][0]).toEqual(['--set-default-version', '2'])

    ;(runWsl as any).mockResolvedValueOnce({
      stdout: '',
      stderr: 'The requested operation requires elevation',
      code: 1,
    })
    const runOne = vi.fn(async () => ({
      op: 'wsl.setDefaultVersion' as const,
      ok: true,
      code: 0,
      stdout: '',
      stderr: '',
    }))
    const svc2 = createWslService(logger(), { elevation: { runOne } as never })
    await svc2.setDefaultVersion(1)
    expect(runOne).toHaveBeenCalledWith({ op: 'wsl.setDefaultVersion', params: { version: 1 } })

    ;(runWsl as any).mockResolvedValueOnce({ stdout: '', stderr: 'boom', code: 1 })
    await expect(svc.setDefaultVersion(2)).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('setSparse：argv 正确；不支持时给「更新 WSL」引导；提权委托', async () => {
    ;(spawnWsl as any).mockImplementation((_a: string[], o: { onExit: (c: number) => void }) => {
      queueMicrotask(() => o.onExit(0))
      return { kill: vi.fn() }
    })
    await svc.setSparse('Ubuntu', true, ctl as never)
    expect((spawnWsl as any).mock.calls[0][0]).toEqual([
      '--manage',
      'Ubuntu',
      '--set-sparse',
      'true',
    ])
    const reports = (ctl.report as ReturnType<typeof vi.fn>).mock.calls
    expect(reports[reports.length - 1]).toEqual([100, '已启用稀疏磁盘：Ubuntu'])

    // 老 WSL 不识别 --set-sparse：映射为更新引导
    ;(spawnWsl as any).mockImplementation(
      (_a: string[], o: { onLine: (l: string) => void; onExit: (c: number) => void }) => {
        o.onLine('Invalid command line option: --set-sparse')
        queueMicrotask(() => o.onExit(1))
        return { kill: vi.fn() }
      },
    )
    await expect(svc.setSparse('Ubuntu', true, ctl as never)).rejects.toMatchObject({
      message: '当前 WSL 不支持稀疏磁盘操作',
      suggestion: expect.stringContaining('设置 → WSL'),
    })

    // 权限不足 → 提权助手（结构化参数）
    ;(spawnWsl as any).mockImplementation(
      (_a: string[], o: { onLine: (l: string) => void; onExit: (c: number) => void }) => {
        o.onLine('The requested operation requires elevation')
        queueMicrotask(() => o.onExit(1))
        return { kill: vi.fn() }
      },
    )
    const runOne = vi.fn(async () => ({
      op: 'wsl.setSparse' as const,
      ok: true,
      code: 0,
      stdout: '',
      stderr: '',
    }))
    const svc2 = createWslService(logger(), { elevation: { runOne } as never })
    await svc2.setSparse('Ubuntu', false, ctl as never)
    expect(runOne).toHaveBeenCalledWith({
      op: 'wsl.setSparse',
      params: { name: 'Ubuntu', sparse: false },
    })
  })
})
