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
  return {
    configService: {
      load,
      patch,
      replace,
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
    registry: {
      detail: vi.fn(async () => ({ name: 'Ubuntu', guid: '{x}' })),
      listGuids: vi.fn(async () => []),
    } as any,
  }
}

function register(ctx: any, deps = makeDeps()) {
  const wrapped = new Map<string, any>()
  registerIpcHandlers({ handle: vi.fn((ch: string, fn: any) => wrapped.set(ch, fn)) } as any, ctx, deps)
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
    expect(deps.registry.detail).toHaveBeenCalledWith('Ubuntu')
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

  it('meta:set inserts or updates', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await wrapped.get(CH.metaSet)({}, {
      name: 'Debian',
      alias: 'test',
      tags: [],
      color: '',
      icon: '',
      note: '',
      startupCwd: '~',
      pinned: false,
      quickActions: [],
    })
    expect(ctx.patch).toHaveBeenCalled()
    const call = (ctx.patch as any).mock.calls[0] as any[]
    const arg = call[1] as { distros: unknown[] }
    expect(arg.distros).toHaveLength(2)
  })

  it('meta:set rejects invalid payload', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await expect(wrapped.get(CH.metaSet)({}, { alias: 'x' })).rejects.toThrow()
    await expect(wrapped.get(CH.metaSet)({}, null)).rejects.toThrow()
  })
})
