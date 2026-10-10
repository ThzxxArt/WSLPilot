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
import { CH } from '@wslpilot/shared'

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
          meta: map.get('Ubuntu') ?? null,
        },
      ]),
      start: vi.fn(async () => {}),
      terminate: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      setDefault: vi.fn(async () => {}),
      getVersion: vi.fn(async () => ({ raw: '', wslVersion: '2', kernelVersion: '5' })),
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

  it("metrics:sample '*' returns overview", async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    const o = await wrapped.get(CH.metricsSample)({}, '*')
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

  it('config handlers reject unknown keys and bad actions', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await expect(wrapped.get(CH.configGet)({}, 'evil')).rejects.toThrow()
    await expect(wrapped.get(CH.configOpenExternal)({}, 'evil')).rejects.toThrow()
    await expect(
      wrapped.get(CH.configResolveConflict)({}, { fileKey: 'settings', action: 'hack' }),
    ).rejects.toThrow()
  })
})
