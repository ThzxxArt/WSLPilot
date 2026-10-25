import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.1.0'),
    getPath: vi.fn(() => '/tmp'),
  },
  shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn(),
}))

// 0.1.3：宿主磁盘占用读取走 node:fs/promises.stat（真实路径不存在时降级；此处注入桩验证接线）
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(async (p: string) => {
        if (String(p).includes('ext4.vhdx')) return { size: 123456789 }
        return actual.promises.stat(p)
      }),
    },
  }
})

import { registerIpcHandlers } from '../../src/main/ipc/router'
import { CH, CONFIG_FILE_NAMES } from '@wslpilot/shared'
import { createTaskRunner } from '../../src/main/services/task-runner'

function makeCtx() {
  const load = vi.fn(async (key: string) => {
    if (key === 'distros') {
      return {
        $schemaVersion: 1,
        distros: [
          {
            name: 'Ubuntu',
            alias: '主力',
            tags: [],
            color: '',
            icon: 'ubuntu',
            note: '',
            startupCwd: '~',
            pinned: false,
            quickActions: [],
          },
        ],
      }
    }
    return { $schemaVersion: 2 }
  })
  const replace = vi.fn(async () => {})
  const patch = vi.fn(async (_k: string, p: unknown) => ({ patched: p }))
  const update = vi.fn(async (_k: string, fn: any) => {
    const current = {
      $schemaVersion: 1,
      distros: [] as any[],
    }
    return fn(current)
  })
  return {
    configService: {
      load,
      patch,
      replace,
      update,
      openInEditor: vi.fn(async () => {}),
      resolveConflict: vi.fn(async () => ({})),
      getConflict: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
      userDataDir: '/tmp',
      dispose: vi.fn(),
    } as any,
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLevel: vi.fn(),
    } as any,
    getMainWindow: vi.fn(() => ({ webContents: { send: vi.fn() } })),
    load,
    replace,
    patch,
  }
}

function makeSyntheticVhdx(virtualSize: bigint): Buffer {
  const region = 192 * 1024
  const meta = 2 * 1024 * 1024
  const buf = Buffer.alloc(meta + 1024)
  buf.write('vhdxfile', 0, 'ascii')
  buf.write('regi', region, 'ascii')
  buf.writeUInt32LE(2, region + 8)
  Buffer.from('6677C22D23F600429D64115E9BFD4A08', 'hex').copy(buf, region + 16)
  buf.writeBigUInt64LE(3n * 1024n * 1024n, region + 32)
  Buffer.from('06A27C8B90479A4BB8FE575F050F886E', 'hex').copy(buf, region + 48)
  buf.writeBigUInt64LE(BigInt(meta), region + 64)
  buf.writeUInt32LE(1024 * 1024, region + 72)
  buf.write('metadata', meta, 'ascii')
  buf.writeUInt16LE(1, meta + 10)
  Buffer.from('2442A52F1BCD7648B2115DBED83BF4B8', 'hex').copy(buf, meta + 32)
  buf.writeUInt32LE(64, meta + 48)
  buf.writeUInt32LE(8, meta + 52)
  buf.writeBigUInt64LE(virtualSize, meta + 64)
  return buf
}

function makeCtl() {
  return {
    taskId: 'tc',
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: vi.fn(),
    onCancel: vi.fn(),
  }
}

function makeDeps() {
  const pty = {
    create: vi.fn(() => ({ ptyId: 'p1', distro: 'U', shell: 'b', createdAt: 0 })),
    createCommand: vi.fn(() => ({ ptyId: 'p2', distro: 'U', shell: 'b', createdAt: 0 })),
    input: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    killAll: vi.fn(),
    list: vi.fn(() => []),
    get: vi.fn(() => null),
    count: vi.fn(() => 0),
    waitExit: vi.fn(async () => 0),
  } as any
  return {
    wsl: {
      list: vi.fn(async () => [
        { name: 'Ubuntu', state: 'Running', version: 2, isDefault: true },
        { name: 'Debian', state: 'Stopped', version: 2, isDefault: false },
      ]),
      listWithMeta: vi.fn(async (map: any) => [
        {
          name: 'Ubuntu',
          state: 'Running',
          version: 2,
          isDefault: true,
          meta: map.get('ubuntu') ?? null,
        },
      ]),
      start: vi.fn(async () => {}),
      terminate: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      setDefault: vi.fn(async () => {}),
      install: vi.fn(async () => {}),
      setVersion: vi.fn(async () => {}),
      setSparse: vi.fn(async () => {}),
      compact: vi.fn(async () => {}),
      resize: vi.fn(async () => {}),
      setDefaultUser: vi.fn(async () => {}),
      unregister: vi.fn(async () => {}),
      getVersion: vi.fn(async () => ({ raw: '', wslVersion: '2', kernelVersion: '5' })),
      // 运行状态硬门禁（review：采样 `wsl -d X -e` 会隐式启动发行版）
      assertRunning: vi.fn(async () => {}),
      sampleMetrics: vi.fn(async () => ({
        memUsedKB: 10,
        memTotalKB: 20,
        diskUsedKB: 1024,
        diskTotalKB: 2048,
        cpuPercent: 1,
        sampledAt: 'T',
      })),
    } as any,
    pty,
    registry: {
      detail: vi.fn(async () => ({ name: 'Ubuntu', guid: '{x}' })),
      detailFull: vi.fn(async () => ({
        guid: '{x}',
        distributionName: 'Ubuntu',
        values: { DistributionName: 'Ubuntu' },
      })),
      listGuids: vi.fn(async () => []),
      listAll: vi.fn(async () => [
        {
          name: 'Ubuntu',
          guid: '{GUID-1}',
          basePath: 'C:\\WSL\\Ubuntu',
          defaultUid: 1000,
        },
      ]),
    } as any,
    io: {
      runExport: vi.fn(async () => ({})),
      runImport: vi.fn(async () => {}),
      runMove: vi.fn(async () => {}),
      listBackups: vi.fn(async () => []),
      cleanupBackups: vi.fn(async () => ({ removed: 0 })),
      resolveBackupDir: vi.fn(() => '/tmp/backups'),
      rotateBackups: vi.fn(async () => 0),
    } as any,
    tasks: {
      start: vi.fn(() => ({ taskId: 't1' })),
      cancel: vi.fn(() => true),
      get: vi.fn(() => null),
      list: vi.fn(() => []),
      running: vi.fn(() => []),
      runningForDistro: vi.fn(() => []),
      withLock: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
      beginShutdown: vi.fn(),
      endShutdown: vi.fn(),
      waitFor: vi.fn(async () => ({})),
      dispose: vi.fn(),
    } as any,
    wslconf: {
      read: vi.fn(async () => ''),
      write: vi.fn(async () => ({ terminated: false })),
    } as any,
    runner: {
      prepare: vi.fn(async () => ({})),
      spawnTerminal: vi.fn(() => null),
      run: vi.fn(async () => {}),
      killSession: vi.fn(),
    } as any,
    fsBridge: {
      readDir: vi.fn(async () => []),
      read: vi.fn(async () => ({ text: '', sizeBytes: 0, truncated: false, binary: false })),
      write: vi.fn(async () => {}),
      revealInExplorer: vi.fn(async () => {}),
    } as any,
    network: {
      status: vi.fn(async () => ({})),
      listPortProxy: vi.fn(async () => []),
      findRule: vi.fn(),
      applyRule: vi.fn(async () => {}),
      applyAll: vi.fn(async () => {}),
      removeRule: vi.fn(async () => {}),
      proxyState: vi.fn(async () => ({ path: '', exists: false, content: '' })),
      proxyApply: vi.fn(async () => {}),
      proxyClear: vi.fn(async () => {}),
    } as any,
    devices: {
      status: vi.fn(async () => ({ installed: false, version: '' })),
      list: vi.fn(async () => []),
      bind: vi.fn(async () => {}),
      unbind: vi.fn(async () => {}),
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
    } as any,
    // 0.1.3：.wslconfig 服务（router deps 必填）
    wslconfig: {
      path: vi.fn(() => '/tmp/.wslconfig'),
      read: vi.fn(async () => ({ path: '/tmp/.wslconfig', exists: false, content: '' })),
      write: vi.fn(async () => ({ path: '/tmp/.wslconfig' })),
    } as any,
  }
}

function register(ctx: any, deps = makeDeps()) {
  const wrapped = new Map<string, any>()
  registerIpcHandlers(
    { handle: vi.fn((ch: string, fn: any) => wrapped.set(ch, fn)) } as any,
    ctx,
    deps,
  )
  return { wrapped, deps }
}

describe('distros + meta IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('distros:list merges meta', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    const list = await wrapped.get(CH.distrosList)({})
    expect(deps.wsl.listWithMeta).toHaveBeenCalled()
    expect(list[0].meta.alias).toBe('主力')
  })

  it('distros:list 的 meta 索引按小写归一（大小写不一致也命中，review 根治）', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    await wrapped.get(CH.distrosList)({})
    const passedMap = deps.wsl.listWithMeta.mock.calls[0]![0] as Map<string, unknown>
    expect([...passedMap.keys()]).toEqual(['ubuntu'])
    expect(passedMap.get('ubuntu')).toMatchObject({ alias: '主力' })
  })

  /**
   * `wsl -l -v` 本就不含 GUID/BasePath/DefaultUid，必须由注册表补齐，
   * 否则迁移向导永远显示「注册表信息不可用」（review C-1 根治）。
   */
  it('distros:list 补齐 Lxss 深层信息（GUID/BasePath/DefaultUid）', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    const list = await wrapped.get(CH.distrosList)({})
    expect(deps.registry.listAll).toHaveBeenCalled()
    expect(list[0].guid).toBe('{GUID-1}')
    expect(list[0].basePath).toBe('C:\\WSL\\Ubuntu')
    expect(list[0].defaultUid).toBe(1000)
    // 0.1.3 链路补齐：宿主磁盘占用从 BasePath/ext4.vhdx 实测（stub 命中 123456789）
    expect(list[0].hostDiskBytes).toBe(123456789)
  })

  it('注册表不可用时降级不阻断（设计书 §9.2）', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    deps.registry.listAll.mockRejectedValueOnce(new Error('registry down'))
    const list = await wrapped.get(CH.distrosList)({})
    // 仍返回列表，只是没有深层信息
    expect(list).toHaveLength(1)
    expect(list[0].guid).toBeUndefined()
  })

  it('发行版名不区分大小写也能命中注册表信息', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    deps.wsl.listWithMeta.mockResolvedValueOnce([
      { name: 'UBUNTU', state: 'Running', version: 2, isDefault: true, meta: null },
    ])
    const list = await wrapped.get(CH.distrosList)({})
    expect(list[0].guid).toBe('{GUID-1}')
    expect(list[0].basePath).toBe('C:\\WSL\\Ubuntu')
  })

  it('distros:start / terminate / shutdown / setDefault', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    await wrapped.get(CH.distrosStart)({}, 'Ubuntu')
    expect(deps.wsl.start).toHaveBeenCalledWith('Ubuntu')

    await wrapped.get(CH.distrosTerminate)({}, 'Ubuntu')
    expect(deps.wsl.terminate).toHaveBeenCalledWith('Ubuntu')

    await wrapped.get(CH.distrosShutdown)({})
    expect(deps.wsl.shutdown).toHaveBeenCalled()

    await wrapped.get(CH.distrosSetDefault)({}, 'Ubuntu')
    expect(deps.wsl.setDefault).toHaveBeenCalledWith('Ubuntu')
  })

  it('直接 terminate/shutdown 与运行中任务互斥（0.1.4）', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    deps.tasks.runningForDistro = vi.fn(() => [
      { taskId: 't1', status: 'running', distro: 'Ubuntu', type: 'export', message: '导出' },
    ])
    deps.tasks.running = vi.fn(() => [
      { taskId: 't1', status: 'running', distro: 'Ubuntu', type: 'export', message: '导出' },
    ])
    await expect(wrapped.get(CH.distrosTerminate)({}, 'Ubuntu')).rejects.toThrow(/运行中的任务/)
    await expect(wrapped.get(CH.distrosShutdown)({})).rejects.toThrow(/运行中的任务/)
    expect(deps.wsl.terminate).not.toHaveBeenCalled()
    expect(deps.wsl.shutdown).not.toHaveBeenCalled()
  })

  it('distros:setSparse 任务化（同发行版锁）', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    await wrapped.get(CH.distrosSetSparse)({}, { name: 'Ubuntu', sparse: true })
    const opts = deps.tasks.start.mock.calls[0]![0]
    expect(opts.type).toBe('manage')
    expect(opts.lockKey).toBe('ubuntu')
    await opts.run({
      taskId: 't',
      report: vi.fn(),
      log: vi.fn(),
      isCanceled: () => false,
      throwIfCanceled: vi.fn(),
      onCancel: vi.fn(),
    })
    expect(deps.wsl.setSparse).toHaveBeenCalledWith('Ubuntu', true, expect.anything())
  })

  it('distros:start rejects missing name', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await expect(wrapped.get(CH.distrosStart)({}, '')).rejects.toThrow()
    await expect(wrapped.get(CH.distrosStart)({}, null)).rejects.toThrow()
  })

  it('registry:detail proxies registry service', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    const d = await wrapped.get(CH.registryDetail)({}, 'Ubuntu')
    expect(deps.registry.detailFull).toHaveBeenCalledWith('Ubuntu')
    expect(d.guid).toBe('{x}')
  })

  it('metrics:sample name returns per-distro metrics', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    const m = await wrapped.get(CH.metricsSample)({}, 'Ubuntu')
    expect(deps.wsl.sampleMetrics).toHaveBeenCalledWith('Ubuntu')
    expect(m.memTotalKB).toBe(20)
  })

  it('硬门禁：未运行发行版拒绝采样（wsl -d X -e 会隐式启动 — review 根治）', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    ;(deps.wsl.assertRunning as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('发行版未运行'),
    )
    await expect(wrapped.get(CH.metricsSample)({}, 'Ubuntu')).rejects.toThrow('未运行')
    expect(deps.wsl.sampleMetrics).not.toHaveBeenCalled()
  })

  it("metrics:sample 拒绝概览保留键 '*'（概览语义已拆到 metrics:overview）", async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    // 入参 schema（metricsNameSchema）在边界即拒绝 `*`，不会漏到执行侧
    await expect(wrapped.get(CH.metricsSample)({}, '*')).rejects.toThrow(/CONFIG_INVALID/)
    expect(deps.wsl.sampleMetrics).not.toHaveBeenCalled()
  })

  it('metrics:overview returns global overview', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    const o = await wrapped.get(CH.metricsOverview)({}, undefined)
    expect(o).toHaveProperty('runningCount')
    expect(o.runningCount).toBe(1)
  })

  it('meta:get returns matching meta or null', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    const m = await wrapped.get(CH.metaGet)({}, 'Ubuntu')
    expect(m.alias).toBe('主力')
    const none = await wrapped.get(CH.metaGet)({}, 'Nope')
    expect(none).toBeNull()
  })

  it('meta:set inserts or updates via write queue', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await wrapped.get(CH.metaSet)(
      {},
      {
        name: 'Debian',
        alias: 'test',
        tags: [],
        color: '',
        icon: '',
        note: '',
        startupCwd: '~',
        pinned: false,
        quickActions: [],
      },
    )
    expect(ctx.configService.update).toHaveBeenCalled()
  })

  it('meta:set rejects invalid payload', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await expect(wrapped.get(CH.metaSet)({}, { alias: 'x' })).rejects.toThrow()
    await expect(wrapped.get(CH.metaSet)({}, null)).rejects.toThrow()
  })

  it('meta 名称大小写不敏感：命中同一条目且不产生重复', async () => {
    const ctx = makeCtx()
    // 让 update 还原到「已有 Ubuntu 条目」的真实读-改-写现场，直接断言改写结果
    ctx.configService.update = vi.fn(async (_k: string, fn: any) =>
      fn({
        $schemaVersion: 1,
        distros: [
          {
            name: 'Ubuntu',
            alias: '主力',
            tags: [],
            color: '',
            icon: 'ubuntu',
            note: '',
            startupCwd: '~',
            pinned: false,
            quickActions: [],
          },
        ],
      }),
    )
    const { wrapped } = register(ctx)

    // 查询：换大小写也命中同一条目
    const hit = await wrapped.get(CH.metaGet)({}, 'uBuNtU')
    expect(hit?.alias).toBe('主力')

    // 写入：换大小写更新同一份，而不是新增条目（保留 meta.name 原样）
    const saved = await wrapped.get(CH.metaSet)(
      {},
      {
        name: 'UBUNTU',
        alias: '新别名',
        tags: [],
        color: '',
        icon: 'ubuntu',
        note: '',
        startupCwd: '~',
        pinned: false,
        quickActions: [],
      },
    )
    expect(saved.name).toBe('UBUNTU')
    const after = (ctx.configService.update as any).mock.results[0].value as Promise<any>
    const file = await after
    expect(file.distros).toHaveLength(1)
    expect(file.distros[0].alias).toBe('新别名')
  })

  it('config 键集合与 shared CONFIG_FILE_NAMES 同源（禁双份事实源）', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    const expected = Object.keys(CONFIG_FILE_NAMES)
    // 变更监听挂载的键必须与 CONFIG_FILE_NAMES 完全一致
    const mounted = (ctx.configService.onChange as any).mock.calls.map((c: any[]) => c[0])
    expect([...mounted].sort()).toEqual([...expected].sort())
    // 每个合法键都能 configGet（不被当成未知键）
    for (const key of expected) {
      await expect(wrapped.get(CH.configGet)({}, key)).resolves.toBeDefined()
    }
    // 集合之外的键仍然拒绝
    await expect(wrapped.get(CH.configGet)({}, 'evil')).rejects.toThrow()
    await expect(wrapped.get(CH.configOpenExternal)({}, 'evil')).rejects.toThrow()
  })

  it('config handlers reject unknown keys and bad actions', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await expect(wrapped.get(CH.configGet)({}, 'evil')).rejects.toThrow()
    await expect(wrapped.get(CH.configOpenExternal)({}, 'evil')).rejects.toThrow()
    await expect(
      wrapped.get(CH.configResolveConflict)({}, { fileKey: 'settings', action: 'hack' }),
    ).rejects.toThrow()
  })

  it('compact 任务在压缩后读取真实 vhdx 并如实报告（无效回收也不谎报成功）', async () => {
    const ctx = makeCtx()
    const deps = makeDeps()
    deps.registry.detail = vi.fn(async () => ({ basePath: 'C:\\WSL\\Ubuntu' }))
    const { wrapped } = register(ctx, deps)
    wrapped.get(CH.distrosCompact)({}, { name: 'Ubuntu', terminateFirst: true })
    const opts = deps.tasks.start.mock.calls[0]![0]
    const ctl = {
      taskId: 'tc',
      report: vi.fn(),
      log: vi.fn(),
      isCanceled: () => false,
      throwIfCanceled: vi.fn(),
      onCancel: vi.fn(),
    }
    await opts.run(ctl)
    expect(deps.wsl.compact).toHaveBeenCalledWith('Ubuntu', true, ctl)
    expect(ctl.report).toHaveBeenLastCalledWith(100, expect.stringContaining('未测得回收'))
  })

  it('distros:resize 以 VHDX 虚拟容量硬门禁拒绝缩容（0.1.4 根治）', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), `wslpilot-resize-${randomUUID()}-`))
    try {
      await fs.writeFile(join(dir, 'ext4.vhdx'), makeSyntheticVhdx(1024n ** 4n))
      const ctx = makeCtx()
      const { wrapped, deps } = register(ctx)
      deps.registry.detail = vi.fn(async () => ({ name: 'Ubuntu', basePath: dir }))

      await wrapped.get(CH.distrosResize)({}, { name: 'Ubuntu', size: '1TB' })
      const shrink = deps.tasks.start.mock.calls[0]![0]
      await expect(shrink.run(makeCtl())).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      expect(deps.wsl.resize).not.toHaveBeenCalled()

      await wrapped.get(CH.distrosResize)({}, { name: 'Ubuntu', size: '2TB' })
      const grow = deps.tasks.start.mock.calls[1]![0]
      const ctl = makeCtl()
      await grow.run(ctl)
      expect(deps.wsl.resize).toHaveBeenCalledWith('Ubuntu', '2TB', ctl)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('distros:install / setVersion / unregister 任务派发与执行（review 假信心 M3）', async () => {
    const ctx = makeCtx()
    const { wrapped, deps } = register(ctx)
    // 异步完成标记：run(ctl) 不 await 时断言时机早于微任务完成 → 必红（悬浮 promise 锁）
    const flags = { install: 0, setVersion: 0 }
    deps.wsl.install = vi.fn(async () => {
      await Promise.resolve()
      flags.install++
    })
    deps.wsl.setVersion = vi.fn(async () => {
      await Promise.resolve()
      flags.setVersion++
    })
    const ctl = {
      taskId: 't',
      report: vi.fn(),
      log: vi.fn(),
      isCanceled: () => false,
      throwIfCanceled: vi.fn(),
      onCancel: vi.fn(),
    }

    // 带名安装：type/lockKey/run 全链路；所有 install 共用全局锁
    await wrapped.get(CH.distrosInstall)({}, { name: 'Ubuntu' })
    expect(deps.tasks.start).toHaveBeenCalledTimes(1)
    const installOpts = deps.tasks.start.mock.calls[0]![0]
    expect(installOpts.type).toBe('install')
    expect(installOpts.distro).toBe('Ubuntu')
    expect(installOpts.lockKey).toBe('wsl:global')
    await installOpts.run(ctl)
    expect(deps.wsl.install).toHaveBeenCalledWith('Ubuntu', ctl, {
      name: 'Ubuntu',
      enableWsl1: false,
      fixedVhd: false,
      webDownload: false,
    })
    expect(flags.install).toBe(1)

    // 省略名字（安装 WSL 本体）：lockKey 走全局锁（与 WSL 更新串行 — 0.1.3）
    await wrapped.get(CH.distrosInstall)({}, {})
    const bareOpts = deps.tasks.start.mock.calls[1]![0]
    expect(bareOpts.lockKey).toBe('wsl:global')
    await bareOpts.run(ctl)
    expect(deps.wsl.install).toHaveBeenCalledWith(undefined, ctl, {
      enableWsl1: false,
      fixedVhd: false,
      webDownload: false,
    })
    expect(flags.install).toBe(2)

    // setVersion → convert 任务
    await wrapped.get(CH.distrosSetVersion)({}, { name: 'Ubuntu', version: 1 })
    const convertOpts = deps.tasks.start.mock.calls[2]![0]
    expect(convertOpts.type).toBe('convert')
    await convertOpts.run(ctl)
    expect(deps.wsl.setVersion).toHaveBeenCalledWith('Ubuntu', 1, ctl)
    expect(flags.setVersion).toBe(1)

    // unregister（0.1.3 任务化）：返回 TaskHandle（router 包装为异步），run 内执行 wsl.unregister
    const handle = await wrapped.get(CH.distrosUnregister)(
      {},
      { name: 'Ubuntu', backupFirst: false },
    )
    expect(handle).toEqual({ taskId: 't1' })
    const unregOpts = deps.tasks.start.mock.calls[3]![0]
    expect(unregOpts.type).toBe('unregister')
    expect(unregOpts.distro).toBe('Ubuntu')
    await unregOpts.run(ctl)
    expect(deps.wsl.unregister).toHaveBeenCalledWith('Ubuntu')
    // 非法名（对象形态入参）在入口拒绝
    await expect(
      wrapped.get(CH.distrosUnregister)({}, { name: 'a/b', backupFirst: false }),
    ).rejects.toThrow()
  })

  it('unregister（0.1.3）：backupFirst=true 先导出备份再注销（同一任务）', async () => {
    const ctx = makeCtx()
    const deps = makeDeps()
    const exportCalls: unknown[] = []
    deps.io.runExport = vi.fn(async (req: unknown) => {
      exportCalls.push(req)
      return {}
    })
    // 备份格式与目录走 settings（makeCtx 的 configService.load 返回 { $schemaVersion: 2 }，
    // 需要带 backup 段的设置值）
    ;(ctx as any).configService.loadSync = vi.fn(() => ({
      backup: {
        defaultDir: '/tmp/backups',
        format: 'tar',
        keepRecent: 5,
        autoBackupBeforeDestructive: true,
      },
    }))
    const { wrapped } = register(ctx, deps)
    wrapped.get(CH.distrosUnregister)({}, { name: 'Ubuntu', backupFirst: true })
    const opts = deps.tasks.start.mock.calls[0]![0]
    const ctl = {
      taskId: 't9',
      report: vi.fn(),
      log: vi.fn(),
      isCanceled: () => false,
      throwIfCanceled: vi.fn(),
      onCancel: vi.fn(),
    }
    await opts.run(ctl)
    expect(exportCalls).toHaveLength(1)
    expect(exportCalls[0]).toMatchObject({ name: 'Ubuntu', format: 'tar', terminateFirst: true })
    // 导出在注销之前完成（调用顺序：runExport → wsl.unregister）
    expect(deps.io.runExport).toHaveBeenCalled()
    expect(deps.wsl.unregister).toHaveBeenCalledWith('Ubuntu')
  })

  it('unregister 走 TaskRunner 排他锁且大小写归一到同键（0.1.3 任务化重写）', async () => {
    const ctx = makeCtx()
    const deps = makeDeps()
    // 其他发行版的运行中任务不阻塞本发行版注销（busy 检查只按同发行版大小写归一）
    deps.tasks.runningForDistro = vi.fn(() => [])
    const { wrapped } = register(ctx, deps)
    wrapped.get(CH.distrosUnregister)({}, { name: 'UBUNTU', backupFirst: false })
    // 与 io 任务同一 lockKey（name.toLowerCase()）：注销绝不与同发行版任务并发
    const opts = deps.tasks.start.mock.calls[0]![0]
    expect(opts.lockKey).toBe('ubuntu')
    expect(opts.distro).toBe('UBUNTU')
    const ctl = {
      taskId: 't10',
      report: vi.fn(),
      log: vi.fn(),
      isCanceled: () => false,
      throwIfCanceled: vi.fn(),
      onCancel: vi.fn(),
    }
    await opts.run(ctl)
    expect(deps.wsl.unregister).toHaveBeenCalledWith('UBUNTU')
  })

  it('unregister 有同发行版运行中任务时拒绝，不排队也不执行（含无锁动作 — 0.1.3 保持）', async () => {
    const ctx = makeCtx()
    const deps = makeDeps()
    // 运行中任务（如无锁终端动作）与请求名大小写不同，仍按小写归一命中
    deps.tasks.runningForDistro = vi.fn(() => [
      { taskId: 't1', status: 'running', distro: 'Ubuntu', type: 'export', message: '导出' },
    ])
    const { wrapped } = register(ctx, deps)
    await expect(
      wrapped.get(CH.distrosUnregister)({}, { name: 'ubuntu', backupFirst: false }),
    ).rejects.toThrow(/有运行中的任务/)
    expect(deps.tasks.start).not.toHaveBeenCalled()
    expect(deps.wsl.unregister).not.toHaveBeenCalled()
  })

  it('unregister 与同发行版长任务严格互斥：运行中直接拒绝，任务结束后放行（0.1.3 任务化重写）', async () => {
    const ctx = makeCtx()
    const deps = makeDeps()
    const tasks = createTaskRunner({ logger: ctx.logger, onProgress: () => {} })
    deps.tasks = tasks as any
    const unregister = vi.fn(async () => {})
    deps.wsl.unregister = unregister
    const { wrapped } = register(ctx, deps)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let started = false
    const exportTask = tasks.start({
      type: 'export',
      distro: 'Ubuntu',
      message: '导出 Ubuntu',
      lockKey: 'ubuntu',
      run: async () => {
        started = true
        await gate
      },
    })
    await vi.waitFor(() => expect(started).toBe(true))

    // 长任务未结束：注销直接拒绝（不得并发执行，也不得排队等待后砸中执行中任务）
    await expect(
      wrapped.get(CH.distrosUnregister)({}, { name: 'ubuntu', backupFirst: false }),
    ).rejects.toThrow(/有运行中的任务/)
    expect(unregister).not.toHaveBeenCalled()

    release()
    await tasks.waitFor(exportTask.taskId)
    // 任务结束后 busy 解除：注销作为任务入队并执行（同一锁键天然串行）
    const handle = await wrapped.get(CH.distrosUnregister)(
      {},
      {
        name: 'ubuntu',
        backupFirst: false,
      },
    )
    await tasks.waitFor(handle.taskId)
    expect(unregister).toHaveBeenCalledWith('ubuntu')
  })
})
