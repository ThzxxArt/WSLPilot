import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Electron mock ──────────────────────────────────────────
vi.mock('electron', () => {
  return {
    app: {
      getVersion: vi.fn(() => '0.1.0'),
      getPath: vi.fn(() => '/tmp/wslpilot-test'),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      setLoginItemSettings: vi.fn(),
      quit: vi.fn(),
    },
    shell: {
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(),
    },
    BrowserWindow: vi.fn(),
  }
})

import { registerIpcHandlers } from '../../src/main/ipc/router'
import {
  CH,
  serializeIpcError,
  deserializeIpcError,
  createAppError,
  toAppError,
} from '@wslpilot/shared'

function makeCtx() {
  const load = vi.fn(async (key: string) => ({ key, $schemaVersion: 2 }))
  const patch = vi.fn(async (_k: string, p: unknown) => ({ patched: p }))
  const openInEditor = vi.fn(async () => {})
  const resolveConflict = vi.fn(async (_k: string, a: string) => ({ action: a }))
  const getConflict = vi.fn(() => null)
  const onChange = vi.fn(() => () => {})

  return {
    configService: {
      load,
      patch,
      openInEditor,
      resolveConflict,
      getConflict,
      onChange,
      userDataDir: '/tmp/cfg',
      dispose: vi.fn(),
      replace: vi.fn(),
    } as any,
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLevel: vi.fn(),
    } as any,
    getMainWindow: vi.fn(() => ({
      webContents: { send: vi.fn() },
    })),
  }
}

type Handlers = Map<string, (ctx: any, ...args: any[]) => any>

function makeDeps() {
  return {
    wsl: {
      list: vi.fn(async () => []),
      listWithMeta: vi.fn(async () => []),
      start: vi.fn(async () => {}),
      terminate: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      setDefault: vi.fn(async () => {}),
      getVersion: vi.fn(async () => ({ raw: '', wslVersion: '', kernelVersion: '' })),
      sampleMetrics: vi.fn(async () => ({
        memUsedKB: 0,
        memTotalKB: 0,
        diskUsedKB: 0,
        diskTotalKB: 0,
        cpuPercent: 0,
        sampledAt: '',
      })),
    } as any,
    registry: {
      detail: vi.fn(async () => ({})),
      listGuids: vi.fn(async () => []),
    } as any,
    pty: {
      create: vi.fn(() => ({ ptyId: 'p1', distro: 'U', shell: '/bin/bash', createdAt: 0 })),
      input: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      killAll: vi.fn(),
      list: vi.fn(() => []),
      get: vi.fn(() => null),
      count: vi.fn(() => 0),
    } as any,
    io: {
      runExport: vi.fn(async () => ({})),
      runImport: vi.fn(async () => {}),
      runMove: vi.fn(async () => {}),
      listBackups: vi.fn(async () => []),
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
      prepare: vi.fn(async () => ({
        action: {
          id: 'a1',
          label: 'A',
          scope: 'distro',
          program: '/bin/true',
          args: [],
          terminal: false,
          confirm: false,
        },
        distro: 'Ubuntu',
        program: '/bin/true',
        args: [],
        rawCommand: 'wsl.exe -d Ubuntu -e /bin/true',
      })),
      spawnTerminal: vi.fn(() => ({ ptyId: 'ap1', distro: 'U', shell: 'p', createdAt: 0 })),
      run: vi.fn(async () => {}),
      killSession: vi.fn(),
    } as any,
    fsBridge: {
      readDir: vi.fn(async () => []),
      read: vi.fn(async () => ({ text: '', sizeBytes: 0, truncated: false, binary: false })),
      write: vi.fn(async () => {}),
      revealInExplorer: vi.fn(async () => {}),
    } as any,
  }
}

function register(ctx: any): { handlers: Handlers; wrapped: Map<string, any> } {
  const handlers: Handlers = new Map()
  const wrapped = new Map<string, any>()
  const fakeIpc: any = {
    handle: vi.fn((channel: string, fn: any) => {
      wrapped.set(channel, fn)
    }),
  }
  registerIpcHandlers(fakeIpc, ctx, makeDeps())
  return { handlers, wrapped }
}

describe('IPC router + handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers config and app channels', () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    const channels = [...wrapped.keys()]
    expect(channels).toContain(CH.configGet)
    expect(channels).toContain(CH.configSet)
    expect(channels).toContain(CH.configOpenExternal)
    expect(channels).toContain(CH.configResolveConflict)
    expect(channels).toContain(CH.appGetVersion)
    expect(channels).toContain(CH.appOpenConfigDir)
    expect(channels).toContain(CH.appWindowMinimize)
    expect(channels).toContain(CH.appWindowMaximize)
    expect(channels).toContain(CH.appWindowClose)
  })

  it('registers M5 channels（wslconf / actions / fs）', () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    const channels = [...wrapped.keys()]
    expect(channels).toContain(CH.wslconfRead)
    expect(channels).toContain(CH.wslconfWrite)
    expect(channels).toContain(CH.actionRun)
    expect(channels).toContain(CH.fsReadDir)
    expect(channels).toContain(CH.fsRead)
    expect(channels).toContain(CH.fsWrite)
    expect(channels).toContain(CH.fsRevealInExplorer)
  })

  it('config:get loads by fileKey', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    const result = await wrapped.get(CH.configGet)({}, 'settings')
    expect(ctx.configService.load).toHaveBeenCalledWith('settings')
    expect(result).toMatchObject({ key: 'settings' })
  })

  it('config:set patches and returns result', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    const result = await wrapped.get(CH.configSet)(
      {},
      {
        fileKey: 'settings',
        patch: { general: { accent: 'ocean' } },
      },
    )
    expect(ctx.configService.patch).toHaveBeenCalled()
    expect(result).toMatchObject({ patched: { general: { accent: 'ocean' } } })
  })

  it('config:get rejects unknown fileKey with serializable error', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await expect(wrapped.get(CH.configGet)({}, 'evil')).rejects.toThrow(/WSLPILOT:/)
  })

  it('config:openExternal calls openInEditor', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await wrapped.get(CH.configOpenExternal)({}, 'settings')
    expect(ctx.configService.openInEditor).toHaveBeenCalledWith('settings')
  })

  it('config:resolveConflict validates action', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await wrapped.get(CH.configResolveConflict)({}, { fileKey: 'settings', action: 'reload' })
    expect(ctx.configService.resolveConflict).toHaveBeenCalledWith('settings', 'reload')

    await expect(
      wrapped.get(CH.configResolveConflict)({}, { fileKey: 'settings', action: 'hack' }),
    ).rejects.toThrow(/WSLPILOT:/)
  })

  it('app:getVersion returns version', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await expect(wrapped.get(CH.appGetVersion)({})).resolves.toBe('0.1.0')
  })

  it('app:openConfigDir opens path', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    await wrapped.get(CH.appOpenConfigDir)({})
    expect(ctx.configService.userDataDir).toBe('/tmp/cfg')
  })

  it('window minimize / maximize / close delegate to window', async () => {
    const ctx = makeCtx()
    const win = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn(() => false),
      close: vi.fn(),
    }
    ctx.getMainWindow = vi.fn(() => win as any)
    const { wrapped } = register(ctx)

    await wrapped.get(CH.appWindowMinimize)({})
    expect(win.minimize).toHaveBeenCalled()

    await wrapped.get(CH.appWindowMaximize)({})
    expect(win.maximize).toHaveBeenCalled()

    win.isMaximized.mockReturnValue(true)
    await wrapped.get(CH.appWindowMaximize)({})
    expect(win.unmaximize).toHaveBeenCalled()

    await wrapped.get(CH.appWindowClose)({})
    expect(win.close).toHaveBeenCalled()
  })

  it('window ops no-op when no window', async () => {
    const ctx = makeCtx()
    ;(ctx.getMainWindow as any) = vi.fn(() => null)
    const { wrapped } = register(ctx)
    await wrapped.get(CH.appWindowMinimize)({})
    await wrapped.get(CH.appWindowClose)({})
  })

  it('router wraps handler failures with serializeIpcError', async () => {
    const ctx = makeCtx()
    ctx.configService.load = vi.fn(async () => {
      throw new Error('boom')
    })
    const { wrapped } = register(ctx)

    await expect(wrapped.get(CH.configGet)({}, 'settings')).rejects.toThrow(/WSLPILOT:/)
  })

  it('serializeIpcError / deserializeIpcError round-trip', () => {
    const original = createAppError('CONFIG_INVALID', { message: 'bad' }).toJSON()
    const err = serializeIpcError(original)
    expect(deserializeIpcError(err)?.code).toBe('CONFIG_INVALID')
    expect(toAppError(new Error('x')).code).toBe('UNKNOWN')
  })

  it('★ parseIpcArgs rejects illegal args before handler (schema layer)', async () => {
    const ctx = makeCtx()
    const { wrapped } = register(ctx)
    // configGet 非法 key —— 由 zod 拦下，错误信息含「参数校验失败」
    await expect(wrapped.get(CH.configGet)({}, 'evil-not-a-key')).rejects.toThrow(/参数校验失败/)
    // distrosStart 空名
    await expect(wrapped.get(CH.distrosStart)({}, '')).rejects.toThrow(/参数校验失败/)
    // metaSet 缺 name
    await expect(wrapped.get(CH.metaSet)({}, { alias: 'x' })).rejects.toThrow(/参数校验失败/)
    // configSet 原型污染键（用 JSON.parse 构造真实 __proto__ own key）
    const evil = JSON.parse('{"fileKey":"settings","patch":{"__proto__":{"polluted":true}}}')
    await expect(wrapped.get(CH.configSet)({}, evil)).rejects.toThrow(/参数校验失败/)
    // 合法调用不抛
    await expect(wrapped.get(CH.configGet)({}, 'settings')).resolves.toBeTruthy()
  })
})
