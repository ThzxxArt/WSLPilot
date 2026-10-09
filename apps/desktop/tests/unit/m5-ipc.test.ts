import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerWslConfHandlers } from '../../src/main/ipc/handlers/wslconf'
import { registerActionHandlers } from '../../src/main/ipc/handlers/actions'
import { registerFsHandlers } from '../../src/main/ipc/handlers/fs'
import { CH } from '@wslpilot/shared'
import type { TaskControl } from '../../src/main/services/task-runner'

function makeCtx(over: Record<string, unknown> = {}) {
  return {
    configService: {
      loadSync: vi.fn((key: string) =>
        key === 'settings'
          ? { wsl: { autoShutdownAfterConfigChange: false } }
          : { $schemaVersion: 1 },
      ),
      load: vi.fn(async () => ({})),
      patch: vi.fn(),
      replace: vi.fn(),
      update: vi.fn(),
      openInEditor: vi.fn(),
      resolveConflict: vi.fn(),
      getConflict: vi.fn(() => null),
      onChange: vi.fn(() => () => {}),
      userDataDir: '/tmp',
      dispose: vi.fn(),
    },
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLevel: vi.fn(),
    },
    getMainWindow: vi.fn(() => null),
    ...over,
  } as any
}

function collect(
  register: (add: any, deps: any) => void,
  deps: any,
): Map<string, (ctx: unknown, arg: unknown) => unknown> {
  const handlers = new Map<string, (ctx: unknown, arg: unknown) => unknown>()
  register((channel: string, handler: any) => handlers.set(channel, handler), deps)
  return handlers
}

describe('wslconf handlers（M5）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('wslconf:read 透传服务', async () => {
    const wslconf = { read: vi.fn(async () => '[a]\nb = 1\n'), write: vi.fn() }
    const handlers = collect(registerWslConfHandlers, { wslconf, wsl: { terminate: vi.fn() } })
    const out = await handlers.get(CH.wslconfRead)!(makeCtx(), 'Ubuntu')
    expect(out).toContain('b = 1')
    expect(wslconf.read).toHaveBeenCalledWith('Ubuntu')
  })

  it('wslconf:write 默认不终止发行版', async () => {
    const wslconf = { read: vi.fn(), write: vi.fn(async () => {}) }
    const terminate = vi.fn(async () => {})
    const handlers = collect(registerWslConfHandlers, { wslconf, wsl: { terminate } })
    const out = await handlers.get(CH.wslconfWrite)!(makeCtx(), {
      name: 'Ubuntu',
      content: '[a]\nb = 1\n',
    })
    expect(out).toEqual({ terminated: false })
    expect(terminate).not.toHaveBeenCalled()
  })

  it('autoShutdownAfterConfigChange 开启时写入后 terminate（8 秒规则）', async () => {
    const wslconf = { read: vi.fn(), write: vi.fn(async () => {}) }
    const terminate = vi.fn(async () => {})
    const handlers = collect(registerWslConfHandlers, { wslconf, wsl: { terminate } })
    const ctx = makeCtx()
    ctx.configService.loadSync = vi.fn(() => ({
      wsl: { autoShutdownAfterConfigChange: true },
    }))
    const out = await handlers.get(CH.wslconfWrite)!(ctx, { name: 'Ubuntu', content: '' })
    expect(out).toEqual({ terminated: true })
    expect(terminate).toHaveBeenCalledWith('Ubuntu')
  })
})

describe('action handlers（M5）', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeTasks() {
    return {
      start: vi.fn((opts: any) => {
        const ctl: TaskControl = {
          taskId: 't1',
          type: opts.type,
          distro: opts.distro,
          report: vi.fn(),
          log: vi.fn(),
          isCanceled: () => false,
          throwIfCanceled: () => {},
          onCancel: vi.fn(),
        }
        void opts.run(ctl)
        return { taskId: 't1' }
      }),
      cancel: vi.fn(),
      get: vi.fn(() => null),
      list: vi.fn(() => []),
      waitFor: vi.fn(async () => ({})),
      dispose: vi.fn(),
    } as any
  }

  it('headless 动作返回 TaskHandle（无 ptyId）并按发行版加锁', async () => {
    const tasks = makeTasks()
    const runner = {
      prepare: vi.fn(async () => ({
        action: {
          id: 'a1',
          label: '测试',
          scope: 'distro',
          program: '/bin/true',
          args: [],
          terminal: false,
          confirm: false,
        },
        distro: 'Ubuntu',
        program: '/bin/true',
        args: [],
        rawCommand: 'wsl.exe …',
      })),
      spawnTerminal: vi.fn(),
      run: vi.fn(async () => {}),
      killSession: vi.fn(),
    }
    const handlers = collect(registerActionHandlers, { runner, tasks })
    const handle = await handlers.get(CH.actionRun)!(makeCtx(), {
      actionId: 'a1',
      distro: 'Ubuntu',
    })
    expect(handle).toEqual({ taskId: 't1', distro: 'Ubuntu' })
    expect(runner.spawnTerminal).not.toHaveBeenCalled()
    expect(tasks.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'action', lockKey: 'ubuntu' }),
    )
  })

  it('terminal 动作附带 ptyId 且不加锁', async () => {
    const tasks = makeTasks()
    const runner = {
      prepare: vi.fn(async () => ({
        action: {
          id: 'a2',
          label: '终端',
          scope: 'distro',
          program: '/bin/bash',
          args: [],
          terminal: true,
          confirm: false,
        },
        distro: 'Ubuntu',
        program: '/bin/bash',
        args: [],
        rawCommand: 'wsl.exe …',
      })),
      spawnTerminal: vi.fn(() => ({ ptyId: 'pty-9' })),
      run: vi.fn(async () => {}),
      killSession: vi.fn(),
    }
    const handlers = collect(registerActionHandlers, { runner, tasks })
    const handle = await handlers.get(CH.actionRun)!(makeCtx(), {
      actionId: 'a2',
      distro: 'Ubuntu',
    })
    expect(handle).toEqual({ taskId: 't1', ptyId: 'pty-9', distro: 'Ubuntu' })
    expect(tasks.start).toHaveBeenCalledWith(expect.objectContaining({ lockKey: null }))
  })

  it('任务启动失败回收临时 PTY', async () => {
    const tasks = {
      start: vi.fn(() => {
        throw new Error('scheduler closed')
      }),
    } as any
    const runner = {
      prepare: vi.fn(async () => ({
        action: {
          id: 'a2',
          label: '终端',
          scope: 'distro',
          program: '/bin/bash',
          args: [],
          terminal: true,
          confirm: false,
        },
        distro: 'Ubuntu',
        program: '/bin/bash',
        args: [],
        rawCommand: 'x',
      })),
      spawnTerminal: vi.fn(() => ({ ptyId: 'pty-9' })),
      run: vi.fn(async () => {}),
      killSession: vi.fn(),
    }
    const handlers = collect(registerActionHandlers, { runner, tasks })
    await expect(
      handlers.get(CH.actionRun)!(makeCtx(), { actionId: 'a2', distro: 'Ubuntu' }),
    ).rejects.toThrow('scheduler closed')
    expect(runner.killSession).toHaveBeenCalledWith('pty-9')
  })
})

describe('fs handlers（M5）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('readDir / read / write / revealInExplorer 透传', async () => {
    const fsBridge = {
      readDir: vi.fn(async () => [{ name: 'etc', path: '/etc', isDirectory: true }]),
      read: vi.fn(async () => ({ text: 'x', sizeBytes: 1, truncated: false, binary: false })),
      write: vi.fn(async () => {}),
      revealInExplorer: vi.fn(async () => {}),
    }
    const handlers = collect(registerFsHandlers, { fsBridge })
    const ctx = makeCtx()

    const entries = await handlers.get(CH.fsReadDir)!(ctx, { distro: 'Ubuntu', path: '/' })
    expect(entries).toHaveLength(1)

    const file = (await handlers.get(CH.fsRead)!(ctx, {
      distro: 'Ubuntu',
      path: '/etc/x',
    })) as { text: string }
    expect(file.text).toBe('x')

    await handlers.get(CH.fsWrite)!(ctx, { distro: 'Ubuntu', path: '/etc/x', data: 'y' })
    expect(fsBridge.write).toHaveBeenCalledWith('Ubuntu', '/etc/x', 'y')

    await handlers.get(CH.fsRevealInExplorer)!(ctx, { distro: 'Ubuntu', path: '/etc' })
    expect(fsBridge.revealInExplorer).toHaveBeenCalled()
  })
})
