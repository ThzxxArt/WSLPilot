import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '0.1.0'), getPath: vi.fn(() => '/tmp') },
  shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn(),
}))

import { registerIpcHandlers } from '../../src/main/ipc/router'
import { CH, MAX_PTY_SESSIONS } from '@wslpilot/shared'

function makeCtx() {
  return {
    configService: {
      load: vi.fn(async () => ({ $schemaVersion: 2 })),
      patch: vi.fn(async () => ({})),
      replace: vi.fn(async () => {}),
      update: vi.fn(async (_k: string, fn: any) => fn({ $schemaVersion: 1, distros: [] })),
      openInEditor: vi.fn(async () => {}),
      resolveConflict: vi.fn(async () => ({})),
      getConflict: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
      loadSync: vi.fn(() => ({ $schemaVersion: 2 })),
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
  }
}

function makeDeps() {
  const pty = {
    create: vi.fn(() => ({ ptyId: 'p1', distro: 'U', shell: '/bin/bash', createdAt: 1 })),
    createCommand: vi.fn(() => ({ ptyId: 'p2', distro: 'U', shell: '/bin/true', createdAt: 1 })),
    input: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    killAll: vi.fn(),
    list: vi.fn(() => [{ ptyId: 'p1', distro: 'U', shell: 'b', createdAt: 1 }]),
    get: vi.fn(() => null),
    count: vi.fn(() => 1),
    waitExit: vi.fn(async () => 0),
  }
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
      detailFull: vi.fn(async () => null),
      listGuids: vi.fn(async () => []),
    } as any,
    pty: pty as any,
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

describe('pty IPC handlers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pty:create returns session info', async () => {
    const { wrapped, deps } = register(makeCtx())
    const info = await wrapped.get(CH.ptyCreate)({}, { distro: 'Ubuntu', cols: 80, rows: 24 })
    expect(deps.pty.create).toHaveBeenCalledWith(
      expect.objectContaining({ distro: 'Ubuntu', cols: 80, rows: 24 }),
    )
    expect(info.ptyId).toBe('p1')
  })

  it('pty:input / resize / kill delegate', async () => {
    const { wrapped, deps } = register(makeCtx())
    await wrapped.get(CH.ptyInput)({}, { ptyId: 'p1', data: 'a' })
    expect(deps.pty.input).toHaveBeenCalledWith('p1', 'a')
    await wrapped.get(CH.ptyResize)({}, { ptyId: 'p1', cols: 90, rows: 30 })
    expect(deps.pty.resize).toHaveBeenCalledWith('p1', 90, 30)
    await wrapped.get(CH.ptyKill)({}, 'p1')
    expect(deps.pty.kill).toHaveBeenCalledWith('p1')
  })

  it('pty:list and maxSessions', async () => {
    const { wrapped } = register(makeCtx())
    const list = await wrapped.get(CH.ptyList)({})
    expect(list).toHaveLength(1)
    await expect(wrapped.get(CH.ptyMaxSessions)({})).resolves.toBe(MAX_PTY_SESSIONS)
  })

  it('rejects missing ptyId / distro', async () => {
    const { wrapped } = register(makeCtx())
    await expect(wrapped.get(CH.ptyInput)({}, { ptyId: '', data: 'x' })).rejects.toThrow()
    await expect(
      wrapped.get(CH.ptyCreate)({}, { distro: '', cols: 80, rows: 24 }),
    ).rejects.toThrow()
  })
})
