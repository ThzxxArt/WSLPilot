import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'

vi.mock('@wslpilot/kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wslpilot/kit')>()
  return {
    ...actual,
    runWsl: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
    spawnWsl: vi.fn(),
  }
})

import { runWsl } from '@wslpilot/kit'
import {
  createIoService,
  resolveTargetFile,
  percentOf,
  assertSafeIoPath,
  type SpawnWslFn,
} from '../../src/main/services/io-service'
import type { TaskControl, TaskRunner } from '../../src/main/services/task-runner'
import { createTaskRunner } from '../../src/main/services/task-runner'
import type { DistroRuntime } from '@wslpilot/shared'

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

interface SpawnBehavior {
  code?: number
  lines?: string[]
  hang?: boolean
  /** spawn 前执行（例如写输出文件） */
  before?: (args: string[]) => void | Promise<void>
}

function makeSpawnFn(record: string[][], behavior: () => SpawnBehavior): SpawnWslFn {
  return ((
    args: string[],
    opts: { onLine: (l: string) => void; onExit: (c: number) => void; onError: (e: Error) => void },
  ) => {
    record.push(args)
    const b = behavior()
    void (async () => {
      await b.before?.(args)
      for (const l of b.lines ?? []) opts.onLine(l)
      if (b.hang) return
      opts.onExit(b.code ?? 0)
    })()
    return {
      kill: vi.fn(() => opts.onExit(1)),
    }
  }) as unknown as SpawnWslFn
}

function makeCtl(onCancelFns: Array<() => void>): TaskControl {
  const ctl: TaskControl = {
    taskId: 't',
    type: 'export',
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: () => {},
    onCancel: (fn) => onCancelFns.push(fn),
  }
  return ctl
}

function makeConfig(
  over: Partial<{
    defaultDir: string
    format: 'tar' | 'vhd'
    keepRecent: number
    autoBackupBeforeDestructive: boolean
  }> = {},
) {
  return {
    loadSync: (_key: 'settings') => ({
      backup: {
        defaultDir: over.defaultDir ?? join(tmpdir(), 'wslpilot-backups'),
        format: over.format ?? 'tar',
        keepRecent: over.keepRecent ?? 5,
        autoBackupBeforeDestructive: over.autoBackupBeforeDestructive ?? true,
      },
    }),
  }
}

function makeDeps(opts: {
  distros?: DistroRuntime[]
  basePath?: string
  spawn?: SpawnWslFn
  config?: ReturnType<typeof makeConfig>
}) {
  return {
    logger: logger(),
    wsl: {
      list: vi.fn(async () => opts.distros ?? []),
      terminate: vi.fn(async () => {}),
    },
    registry: {
      detail: vi.fn(async () => (opts.basePath ? { basePath: opts.basePath } : {})),
    },
    configService: opts.config ?? makeConfig(),
    spawnFn: opts.spawn,
  }
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wslpilot-io-'))
}

describe('io-service helpers', () => {
  it('resolveTargetFile appends extension and resolves', () => {
    expect(resolveTargetFile('backup', 'tar')).toMatch(/backup\.tar$/)
    expect(resolveTargetFile('backup', 'vhd')).toMatch(/backup\.vhdx$/)
    expect(resolveTargetFile('backup.tar', 'tar')).toMatch(/backup\.tar$/)
    expect(resolveTargetFile('disk.vhdx', 'vhd')).toMatch(/disk\.vhdx$/)
  })

  it('percentOf returns null when total unknown and clamps to 99', () => {
    expect(percentOf(50, 0)).toBeNull()
    expect(percentOf(50, Number.NaN)).toBeNull()
    expect(percentOf(0, 100)).toBe(0)
    expect(percentOf(50, 100)).toBe(50)
    expect(percentOf(100, 100)).toBe(99)
    expect(percentOf(-5, 100)).toBe(0)
    expect(percentOf(Number.NaN, 100)).toBe(0)
  })

  it('assertSafeIoPath rejects empty and control chars', () => {
    expect(() => assertSafeIoPath('')).toThrow()
    expect(() => assertSafeIoPath('a\u0000b')).toThrow()
    expect(assertSafeIoPath('  /tmp/x  ')).toMatch(/x$/)
  })
})

describe('IoService.runExport', () => {
  let distroDir: string
  let outDir: string

  beforeEach(async () => {
    vi.mocked(runWsl).mockClear()
    distroDir = await tmp()
    outDir = await tmp()
    await fs.writeFile(join(distroDir, 'ext4.vhdx'), Buffer.alloc(1024))
  })

  it('exports distro to file and reports success', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({
      before: async (args) => {
        await fs.writeFile(args[2]!, Buffer.alloc(256))
      },
    }))
    const deps = makeDeps({
      distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
      basePath: distroDir,
      spawn,
    })
    const io = createIoService(deps)
    const ctl = makeCtl([]) as unknown as Parameters<typeof io.runExport>[1]

    const out = await io.runExport(
      { name: 'Ubuntu', path: join(outDir, 'Ubuntu-backup'), format: 'tar' },
      ctl,
    )
    expect(calls[0]).toEqual(['--export', 'Ubuntu', join(outDir, 'Ubuntu-backup.tar')])
    expect(out.path).toMatch(/Ubuntu-backup\.tar$/)
    expect(out.sizeBytes).toBe(256)
    expect(ctl.report).toHaveBeenCalledWith(100, '导出完成')
  })

  it('passes --vhd flag and refuses vhd for WSL1', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({
      before: async (args) => {
        await fs.writeFile(args[2]!, Buffer.alloc(10))
      },
    }))
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'U1', state: 'Stopped', version: 1, isDefault: false }],
        spawn,
      }),
    )
    await expect(
      io.runExport({ name: 'U1', path: join(outDir, 'u'), format: 'vhd' }, makeCtl([]) as never),
    ).rejects.toMatchObject({ code: 'TASK_FAILED' })

    const io2 = createIoService(
      makeDeps({
        distros: [{ name: 'U2', state: 'Stopped', version: 2, isDefault: false }],
        basePath: distroDir,
        spawn,
      }),
    )
    await io2.runExport(
      { name: 'U2', path: join(outDir, 'u2'), format: 'vhd' },
      makeCtl([]) as never,
    )
    expect(calls[0]).toEqual(['--export', 'U2', join(outDir, 'u2.vhdx'), '--vhd'])
  })

  it('throws DISTRO_NOT_FOUND for unknown distro', async () => {
    const io = createIoService(makeDeps({ distros: [], spawn: makeSpawnFn([], () => ({})) }))
    await expect(
      io.runExport({ name: 'Nope', path: join(outDir, 'x'), format: 'tar' }, makeCtl([]) as never),
    ).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
  })

  it('rotates old backups per keepRecent', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({
      before: async (args) => {
        await fs.writeFile(args[2]!, Buffer.alloc(8))
      },
    }))
    // 预置 3 份旧备份（命名规范）
    for (const stamp of ['20260101-000000', '20260102-000000', '20260103-000000']) {
      await fs.writeFile(join(outDir, `Ubuntu_${stamp}.tar`), 'old')
    }
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn,
        config: makeConfig({ keepRecent: 2 }),
      }),
    )
    await io.runExport(
      { name: 'Ubuntu', path: join(outDir, 'Ubuntu_20260104-000000.tar'), format: 'tar' },
      makeCtl([]) as never,
    )
    const files = (await fs.readdir(outDir)).filter((f) => f.startsWith('Ubuntu_')).sort()
    expect(files).toHaveLength(2)
    expect(files).toContain('Ubuntu_20260104-000000.tar')
  })

  it('surfaces spawn failure as TASK_FAILED with raw command', async () => {
    const spawn = makeSpawnFn([], () => ({ code: 3, lines: ['错误：磁盘已满'] }))
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn,
      }),
    )
    await expect(
      io.runExport(
        { name: 'Ubuntu', path: join(outDir, 'f.tar'), format: 'tar' },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({
      code: 'TASK_FAILED',
      rawCommand: expect.stringContaining('--export'),
    })
  })

  it('estimates size from directory walk for WSL1 / missing vhdx', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({
      before: async (args) => {
        await fs.writeFile(args[2]!, Buffer.alloc(16))
      },
    }))
    // WSL1：无 ext4.vhdx → dirSizeBytes
    await fs.writeFile(join(distroDir, 'data.img'), Buffer.alloc(64))
    const io1 = createIoService(
      makeDeps({
        distros: [{ name: 'U1', state: 'Stopped', version: 1, isDefault: false }],
        basePath: distroDir,
        spawn,
      }),
    )
    const ctl1 = makeCtl([])
    await io1.runExport({ name: 'U1', path: join(outDir, 'u1'), format: 'tar' }, ctl1 as never)
    // dirSizeBytes 统计到 64 字节源（+vhdx 1024）→ expected>0，进度观察至少触发一次 0
    expect(ctl1.report).toHaveBeenCalledWith(0, '正在导出 U1')

    // WSL2 但无 vhdx → 回退目录统计
    const noVhdx = await tmp()
    await fs.writeFile(join(noVhdx, 'file.bin'), Buffer.alloc(32))
    const io2 = createIoService(
      makeDeps({
        distros: [{ name: 'U2', state: 'Stopped', version: 2, isDefault: false }],
        basePath: noVhdx,
        spawn,
      }),
    )
    await io2.runExport(
      { name: 'U2', path: join(outDir, 'u2'), format: 'tar' },
      makeCtl([]) as never,
    )
    expect(calls.length).toBe(2)
  })

  it('watchProgress reports percent from file growth during export', async () => {
    const calls: string[][] = []
    const ctl = makeCtl([])
    const spawn: SpawnWslFn = ((args: string[], opts: { onExit: (c: number) => void }) => {
      calls.push(args)
      const target = args[2]!
      setTimeout(() => {
        void fs.writeFile(target, Buffer.alloc(512))
      }, 50)
      setTimeout(() => opts.onExit(0), 800)
      return { kill: vi.fn() }
    }) as unknown as SpawnWslFn
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn,
      }),
    )
    await io.runExport(
      { name: 'Ubuntu', path: join(outDir, 'watch.tar'), format: 'tar' },
      ctl as never,
    )
    // 500ms tick 看到 512/1024 → 50%
    const mid = (ctl.report as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === 'number' && c[0] > 0 && c[0] < 100,
    )
    expect(mid).toBeTruthy()
    expect(mid![0]).toBeGreaterThanOrEqual(0)
    expect(mid![0]).toBeLessThan(100)
  })
})

describe('IoService.runImport', () => {
  let installDir: string
  let srcDir: string

  beforeEach(async () => {
    vi.mocked(runWsl).mockClear()
    installDir = await tmp()
    srcDir = await tmp()
  })

  it('rejects duplicate distro name', async () => {
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        spawn: makeSpawnFn([], () => ({})),
      }),
    )
    await expect(
      io.runImport(
        {
          name: 'Ubuntu',
          installPath: installDir,
          archivePath: join(srcDir, 'a.tar'),
          format: 'tar',
          version: 2,
          inPlace: false,
        },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'TASK_FAILED', message: expect.stringContaining('同名') })
  })

  it('rejects missing archive file', async () => {
    const io = createIoService(makeDeps({ distros: [], spawn: makeSpawnFn([], () => ({})) }))
    await expect(
      io.runImport(
        {
          name: 'New',
          installPath: installDir,
          archivePath: join(srcDir, 'missing.tar'),
          format: 'tar',
          version: 2,
          inPlace: false,
        },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('imports tar archive with --version and verifies registration', async () => {
    const archive = join(srcDir, 'a.tar')
    await fs.writeFile(archive, Buffer.alloc(100))
    const calls: string[][] = []
    let listCount = 0
    const spawn = makeSpawnFn(calls, () => ({ lines: ['importing...'] }))
    const deps = makeDeps({ distros: [], spawn })
    // 导入后 findDistro 应找到
    deps.wsl.list = vi.fn(async () => {
      listCount++
      return listCount > 1 ? [{ name: 'New', state: 'Stopped', version: 2, isDefault: false }] : []
    }) as any
    const io = createIoService(deps)
    await io.runImport(
      {
        name: 'New',
        installPath: installDir,
        archivePath: archive,
        format: 'tar',
        version: 1,
        inPlace: false,
      },
      makeCtl([]) as never,
    )
    expect(calls[0]).toEqual(['--import', 'New', installDir, archive, '--version', '1'])
  })

  it('imports in-place for vhdx without install path', async () => {
    const vhdx = join(srcDir, 'disk.vhdx')
    await fs.writeFile(vhdx, Buffer.alloc(50))
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({}))
    const deps = makeDeps({ distros: [], spawn })
    deps.wsl.list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { name: 'InSitu', state: 'Stopped', version: 2, isDefault: false },
      ]) as any
    const io = createIoService(deps)
    await io.runImport(
      {
        name: 'InSitu',
        installPath: '',
        archivePath: vhdx,
        format: 'vhd',
        version: 2,
        inPlace: true,
      },
      makeCtl([]) as never,
    )
    expect(calls[0]).toEqual(['--import-in-place', 'InSitu', vhdx])
  })

  it('rejects in-place for tar format', async () => {
    const archive = join(srcDir, 'a.tar')
    await fs.writeFile(archive, Buffer.alloc(10))
    const io = createIoService(makeDeps({ distros: [], spawn: makeSpawnFn([], () => ({})) }))
    await expect(
      io.runImport(
        {
          name: 'X',
          installPath: '',
          archivePath: archive,
          format: 'tar',
          version: 2,
          inPlace: true,
        },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('rolls back failed archive import via wsl --unregister', async () => {
    const archive = join(srcDir, 'a.tar')
    await fs.writeFile(archive, Buffer.alloc(10))
    const spawn = makeSpawnFn([], () => ({ code: 1, lines: ['导入失败'] }))
    const deps = makeDeps({ distros: [], spawn })
    deps.wsl.list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ name: 'New', state: 'Stopped', version: 2, isDefault: false }]) as any
    const io = createIoService(deps)
    await expect(
      io.runImport(
        {
          name: 'New',
          installPath: installDir,
          archivePath: archive,
          format: 'tar',
          version: 2,
          inPlace: false,
        },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(runWsl).toHaveBeenCalledWith(['--unregister', 'New'])
  })

  it('does not roll back failed in-place import (protect source vhdx)', async () => {
    const vhdx = join(srcDir, 'disk.vhdx')
    await fs.writeFile(vhdx, Buffer.alloc(10))
    const spawn = makeSpawnFn([], () => ({ code: 1, lines: ['失败'] }))
    const io = createIoService(makeDeps({ distros: [], spawn }))
    await expect(
      io.runImport(
        {
          name: 'InSitu',
          installPath: '',
          archivePath: vhdx,
          format: 'vhd',
          version: 2,
          inPlace: true,
        },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(runWsl).not.toHaveBeenCalled()
  })

  it('rollback removes self-created empty install dir', async () => {
    const archive = join(srcDir, 'a.tar')
    await fs.writeFile(archive, Buffer.alloc(10))
    const created = join(srcDir, 'new-install')
    const spawn = makeSpawnFn([], () => ({ code: 1 }))
    const deps = makeDeps({ distros: [], spawn })
    deps.wsl.list = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([]) as any // 回滚时未注册成功 → 只清目录
    const io = createIoService(deps)
    await expect(
      io.runImport(
        {
          name: 'New',
          installPath: created,
          archivePath: archive,
          format: 'tar',
          version: 2,
          inPlace: false,
        },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'TASK_FAILED' })
    await expect(fs.stat(created)).rejects.toThrow()
    expect(runWsl).not.toHaveBeenCalled()
  })

  it('rollback：注册残留时 unregister，非空自建目录不删，注销失败仅告警', async () => {
    const archive = join(srcDir, 'a.tar')
    await fs.writeFile(archive, Buffer.alloc(10))
    const created = join(srcDir, 'dirty-install')
    const spawn = makeSpawnFn([], () => ({
      code: 1,
      before: async () => {
        await fs.mkdir(created, { recursive: true })
        await fs.writeFile(join(created, 'partial.vhdx'), 'x')
      },
    }))
    vi.mocked(runWsl).mockResolvedValueOnce({ stdout: '', stderr: 'busy', code: 1 })
    const deps = makeDeps({ distros: [], spawn })
    deps.wsl.list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ name: 'New', state: 'Stopped', version: 2, isDefault: false }]) as any
    const io = createIoService(deps)
    await expect(
      io.runImport(
        {
          name: 'New',
          installPath: created,
          archivePath: archive,
          format: 'tar',
          version: 2,
          inPlace: false,
        },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(runWsl).toHaveBeenCalledWith(['--unregister', 'New'])
    // 非空目录保留
    await expect(fs.stat(join(created, 'partial.vhdx'))).resolves.toBeTruthy()
  })

  it('vhd 导入拒绝非 vhdx 归档', async () => {
    const archive = join(srcDir, 'a.tar')
    await fs.writeFile(archive, Buffer.alloc(10))
    const io = createIoService(makeDeps({ distros: [], spawn: makeSpawnFn([], () => ({})) }))
    await expect(
      io.runImport(
        {
          name: 'N',
          installPath: installDir!,
          archivePath: archive,
          format: 'vhd',
          version: 2,
          inPlace: false,
        },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'TASK_FAILED', message: expect.stringContaining('vhdx') })
  })
})

describe('IoService.runMove', () => {
  let distroDir: string
  let targetParent: string

  beforeEach(async () => {
    distroDir = await tmp()
    targetParent = await tmp()
    await fs.writeFile(join(distroDir, 'ext4.vhdx'), Buffer.alloc(2048))
    vi.mocked(runWsl).mockClear()
  })

  it('throws DISTRO_RUNNING when running and terminateFirst=false', async () => {
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Running', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn: makeSpawnFn([], () => ({})),
      }),
    )
    await expect(
      io.runMove(
        { name: 'Ubuntu', path: join(targetParent, 'Ubuntu'), terminateFirst: false },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'DISTRO_RUNNING' })
  })

  it('terminates first when requested and moves with --manage --move', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({}))
    const deps = makeDeps({
      distros: [{ name: 'Ubuntu', state: 'Running', version: 2, isDefault: true }],
      basePath: distroDir,
      spawn,
      config: makeConfig({ autoBackupBeforeDestructive: false }),
    })
    const io = createIoService(deps)
    await io.runMove(
      { name: 'Ubuntu', path: join(targetParent, 'Ubuntu'), terminateFirst: true },
      makeCtl([]) as never,
    )
    expect(deps.wsl.terminate).toHaveBeenCalledWith('Ubuntu')
    expect(calls[0]).toEqual(['--manage', 'Ubuntu', '--move', join(targetParent, 'Ubuntu')])
  })

  it('auto-backs up before move when enabled', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({
      before: async (args) => {
        if (args[0] === '--export') await fs.writeFile(args[2]!, Buffer.alloc(8))
      },
    }))
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn,
        config: makeConfig({ autoBackupBeforeDestructive: true }),
      }),
    )
    await io.runMove(
      { name: 'Ubuntu', path: join(targetParent, 'Ubuntu'), terminateFirst: false },
      makeCtl([]) as never,
    )
    expect(calls[0]![0]).toBe('--export')
    expect(calls[1]).toEqual(['--manage', 'Ubuntu', '--move', join(targetParent, 'Ubuntu')])
  })

  it('aborts move when pre-backup fails', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({ code: 1 }))
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn,
        config: makeConfig({ autoBackupBeforeDestructive: true }),
      }),
    )
    await expect(
      io.runMove(
        { name: 'Ubuntu', path: join(targetParent, 'Ubuntu'), terminateFirst: false },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({
      code: 'TASK_FAILED',
      message: expect.stringContaining('自动备份失败'),
    })
    expect(calls.every((c) => c[0] !== '--manage')).toBe(true)
  })

  it('rejects move to same location as current basePath', async () => {
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn: makeSpawnFn([], () => ({})),
        config: makeConfig({ autoBackupBeforeDestructive: false }),
      }),
    )
    await expect(
      io.runMove({ name: 'Ubuntu', path: distroDir, terminateFirst: false }, makeCtl([]) as never),
    ).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('enriches error when wsl --manage is unsupported', async () => {
    const spawn = makeSpawnFn([], () => ({
      code: 1,
      lines: ['Invalid command line option: --manage'],
    }))
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn,
        config: makeConfig({ autoBackupBeforeDestructive: false }),
      }),
    )
    await expect(
      io.runMove(
        { name: 'Ubuntu', path: join(targetParent, 'Ubuntu'), terminateFirst: false },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({
      code: 'TASK_FAILED',
      message: expect.stringContaining('不支持'),
      suggestion: expect.stringContaining('wsl --update'),
    })
  })

  it('throws DISTRO_NOT_FOUND for unknown distro', async () => {
    const io = createIoService(
      makeDeps({ distros: [], spawn: makeSpawnFn([], () => ({})), config: makeConfig() }),
    )
    await expect(
      io.runMove(
        { name: 'Nope', path: join(targetParent, 'x'), terminateFirst: false },
        makeCtl([]) as never,
      ),
    ).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
  })
})

describe('IoService backups listing & rotation', () => {
  it('lists backup files sorted by mtime desc', async () => {
    const dir = await tmp()
    await fs.writeFile(join(dir, 'Ubuntu_20260101-000000.tar'), 'a')
    await fs.writeFile(join(dir, 'Debian_20260102-000000.vhdx'), 'b')
    await fs.writeFile(join(dir, 'readme.txt'), 'x')
    const io = createIoService(makeDeps({ config: makeConfig({ defaultDir: dir }) }))
    const list = await io.listBackups()
    expect(list).toHaveLength(2)
    expect(list.map((f) => f.name).sort()).toEqual([
      'Debian_20260102-000000.vhdx',
      'Ubuntu_20260101-000000.tar',
    ])
    expect(list[0]!.format === 'tar' || list[0]!.format === 'vhd').toBe(true)
  })

  it('returns empty list for missing dir', async () => {
    const io = createIoService(
      makeDeps({ config: makeConfig({ defaultDir: join(tmpdir(), 'no-such-dir-xyz') }) }),
    )
    expect(await io.listBackups()).toEqual([])
  })

  it('rotateBackups keeps newest N and reports removed count', async () => {
    const dir = await tmp()
    for (const stamp of ['20260101-000000', '20260102-000000', '20260103-000000']) {
      await fs.writeFile(join(dir, `Ubuntu_${stamp}.tar`), 'x')
    }
    await fs.writeFile(join(dir, 'Other_20260101-000000.tar'), 'keep')
    const io = createIoService(makeDeps({ config: makeConfig() }))
    const removed = await io.rotateBackups(dir, 'Ubuntu', 1)
    expect(removed).toBe(2)
    const left = (await fs.readdir(dir)).sort()
    expect(left).toEqual(['Other_20260101-000000.tar', 'Ubuntu_20260103-000000.tar'])
  })

  it('cleanupBackups 按发行版分组轮转全部备份', async () => {
    const dir = await tmp()
    for (const stamp of ['20260101-000000', '20260102-000000']) {
      await fs.writeFile(join(dir, `Ubuntu_${stamp}.tar`), 'x')
    }
    await fs.writeFile(join(dir, 'Debian_20260101-000000.tar'), 'x')
    await fs.writeFile(join(dir, 'Debian_20260102-000000.vhdx'), 'x')
    await fs.writeFile(join(dir, 'Debian_20260103-000000.tar'), 'x')
    await fs.writeFile(join(dir, 'junk.txt'), 'x')
    const io = createIoService(makeDeps({ config: makeConfig({ defaultDir: dir }) }))
    const { removed } = await io.cleanupBackups(undefined, 1)
    // Ubuntu: 2→1 删1；Debian: 3→1 删2
    expect(removed).toBe(3)
    const left = (await fs.readdir(dir)).sort()
    expect(left).toEqual(['Debian_20260103-000000.tar', 'Ubuntu_20260102-000000.tar', 'junk.txt'])
  })

  it('cleanupBackups 对缺失目录返回 0', async () => {
    const io = createIoService(makeDeps({ config: makeConfig() }))
    expect(await io.cleanupBackups(join(tmpdir(), 'no-such-xyz'), 5)).toEqual({ removed: 0 })
  })

  it('resolveBackupDir expands env vars', () => {
    const io = createIoService(
      makeDeps({ config: makeConfig({ defaultDir: join(tmpdir(), 'bk') }) }),
    )
    expect(io.resolveBackupDir()).toMatch(/bk$/)
  })

  it('resolveTargetFile 纠正扩展名错配（review M12）', () => {
    expect(resolveTargetFile('out.tar', 'vhd')).toMatch(/out\.vhdx$/)
    expect(resolveTargetFile('out.vhdx', 'tar')).toMatch(/out\.tar$/)
    expect(resolveTargetFile('out.vhd', 'tar')).toMatch(/out\.tar$/)
    expect(resolveTargetFile('out', 'tar')).toMatch(/out\.tar$/)
    expect(resolveTargetFile('out.tar', 'tar')).toMatch(/out\.tar$/)
  })

  it('导出目标已存在时改名保留为 .bak-<ts>（review M12）', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({
      before: async (args) => {
        await fs.writeFile(args[2]!, Buffer.alloc(8))
      },
    }))
    const localDistro = await tmp()
    const localOut = await tmp()
    await fs.writeFile(join(localDistro, 'ext4.vhdx'), Buffer.alloc(64))
    const target = join(localOut, 'exists.tar')
    await fs.writeFile(target, 'OLD-CONTENT')
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: localDistro,
        spawn,
      }),
    )
    await io.runExport({ name: 'Ubuntu', path: target, format: 'tar' }, makeCtl([]) as never)
    const files = await fs.readdir(localOut)
    expect(files.some((f) => f.startsWith('exists.tar.bak-'))).toBe(true)
  })

  it('目标被占用无法改名时中止导出、不覆盖原文件（核验修复）', async () => {
    const calls: string[][] = []
    const spawn = makeSpawnFn(calls, () => ({
      before: async (args) => {
        await fs.writeFile(args[2]!, Buffer.alloc(8))
      },
    }))
    const localDistro = await tmp()
    const localOut = await tmp()
    await fs.writeFile(join(localDistro, 'ext4.vhdx'), Buffer.alloc(64))
    const target = join(localOut, 'locked.tar')
    await fs.writeFile(target, 'OLD-CONTENT')
    const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('EPERM: locked'))
    try {
      const io = createIoService(
        makeDeps({
          distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
          basePath: localDistro,
          spawn,
        }),
      )
      await expect(
        io.runExport({ name: 'Ubuntu', path: target, format: 'tar' }, makeCtl([]) as never),
      ).rejects.toMatchObject({ code: 'IO_ERROR', message: expect.stringContaining('中止') })
      // 原文件未被动过，wsl --export 未被调用
      expect(await fs.readFile(target, 'utf8')).toBe('OLD-CONTENT')
      expect(calls).toHaveLength(0)
    } finally {
      renameSpy.mockRestore()
    }
  })
})

describe('IoService + TaskRunner integration (cancel)', () => {
  it('kill on cancel makes export fail with TASK_CANCELED', async () => {
    const progress: string[] = []
    const runner: TaskRunner = createTaskRunner({
      logger: logger(),
      onProgress: (p) => progress.push(`${p.status}`),
    })
    let ctlRef: TaskControl | null = null
    const spawn = ((
      args: string[],
      opts: { onLine: (l: string) => void; onExit: (c: number) => void },
    ) => {
      void args
      // 挂起，等待 kill
      return {
        kill: () => opts.onExit(1),
      }
    }) as unknown as SpawnWslFn

    const distroDir = await tmp()
    await fs.writeFile(join(distroDir, 'ext4.vhdx'), Buffer.alloc(10))
    const outDir = await tmp()
    const io = createIoService(
      makeDeps({
        distros: [{ name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true }],
        basePath: distroDir,
        spawn,
      }),
    )
    const handle = runner.start({
      type: 'export',
      distro: 'Ubuntu',
      message: '导出 Ubuntu',
      run: (ctl) => {
        ctlRef = ctl
        return io
          .runExport({ name: 'Ubuntu', path: join(outDir, 'x.tar'), format: 'tar' }, ctl)
          .then(() => undefined)
      },
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(ctlRef).not.toBeNull()
    runner.cancel(handle.taskId)
    const rec = await runner.waitFor(handle.taskId)
    expect(rec.status).toBe('canceled')
  })
})
