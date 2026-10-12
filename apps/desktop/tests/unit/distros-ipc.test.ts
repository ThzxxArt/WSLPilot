import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.1.0'),
    getPath: vi.fn(() => '/tmp'),
  },
  shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn(),
}))

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
      waitFor: vi.fn(async () => ({})),
      runExclusive: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
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

    // 带名安装：type/lockKey/run 全链路
    await wrapped.get(CH.distrosInstall)({}, { name: 'Ubuntu' })
    expect(deps.tasks.start).toHaveBeenCalledTimes(1)
    const installOpts = deps.tasks.start.mock.calls[0]![0]
    expect(installOpts.type).toBe('install')
    expect(installOpts.distro).toBe('Ubuntu')
    expect(installOpts.lockKey).toBe('install:ubuntu')
    await installOpts.run(ctl)
    expect(deps.wsl.install).toHaveBeenCalledWith('Ubuntu', ctl)
    expect(flags.install).toBe(1)

    // 省略名字（安装 WSL 本体）：lockKey 走全局
    await wrapped.get(CH.distrosInstall)({}, {})
    const bareOpts = deps.tasks.start.mock.calls[1]![0]
    expect(bareOpts.lockKey).toBe('install:*')
    await bareOpts.run(ctl)
    expect(deps.wsl.install).toHaveBeenCalledWith(undefined, ctl)
    expect(flags.install).toBe(2)

    // setVersion → convert 任务
    await wrapped.get(CH.distrosSetVersion)({}, { name: 'Ubuntu', version: 1 })
    const convertOpts = deps.tasks.start.mock.calls[2]![0]
    expect(convertOpts.type).toBe('convert')
    await convertOpts.run(ctl)
    expect(deps.wsl.setVersion).toHaveBeenCalledWith('Ubuntu', 1, ctl)
    expect(flags.setVersion).toBe(1)

    // unregister 直达 wsl.unregister
    await wrapped.get(CH.distrosUnregister)({}, 'Ubuntu')
    expect(deps.wsl.unregister).toHaveBeenCalledWith('Ubuntu')
    await expect(wrapped.get(CH.distrosUnregister)({}, 'a/b')).rejects.toThrow()
  })

  it('unregister 走 TaskRunner 排他锁且大小写归一到同键（review 0.1.2 审计修复）', async () => {
    const ctx = makeCtx()
    const deps = makeDeps()
    const runExclusive = vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn())
    deps.tasks.runExclusive = runExclusive
    const { wrapped } = register(ctx, deps)
    await wrapped.get(CH.distrosUnregister)({}, 'UBUNTU')
    // 与 io 任务同一 lockKey（name.toLowerCase()）：注销绝不与同发行版任务并发
    expect(runExclusive).toHaveBeenCalledWith('ubuntu', expect.any(Function))
    expect(deps.wsl.unregister).toHaveBeenCalledWith('UBUNTU')
    // 成功后不再走旧的 check-then-act 列表检查
    expect(deps.tasks.list).not.toHaveBeenCalled()
  })

  it('unregister 与同发行版长任务严格互斥：排在运行中任务之后而非并发（review 0.1.2 审计修复）', async () => {
    const ctx = makeCtx()
    const deps = makeDeps()
    const tasks = createTaskRunner({ logger: ctx.logger, onProgress: () => {} })
    deps.tasks = tasks as any
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    deps.wsl.unregister = vi.fn(async () => {
      order.push('unregister')
    })
    const { wrapped } = register(ctx, deps)

    const exportTask = tasks.start({
      type: 'export',
      distro: 'Ubuntu',
      message: '导出 Ubuntu',
      lockKey: 'ubuntu',
      run: async () => {
        order.push('task:start')
        await gate
        order.push('task:end')
      },
    })
    await vi.waitFor(() => expect(order).toContain('task:start'))

    const p = wrapped.get(CH.distrosUnregister)({}, 'Ubuntu')
    await new Promise((r) => setTimeout(r, 10))
    // 长任务未结束：注销必须排队等待（不得并发砸中执行中任务）
    expect(order).toEqual(['task:start'])
    expect(deps.wsl.unregister).not.toHaveBeenCalled()

    release()
    await p
    await tasks.waitFor(exportTask.taskId)
    expect(order).toEqual(['task:start', 'task:end', 'unregister'])
  })
})
