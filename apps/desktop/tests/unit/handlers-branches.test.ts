import { describe, it, expect, vi } from 'vitest'
import { CH } from '@wslpilot/shared'
import { registerPtyHandlers } from '../../src/main/ipc/handlers/pty'
import { registerShellHandlers } from '../../src/main/ipc/handlers/shell'
import { registerContainerHandlers } from '../../src/main/ipc/handlers/containers'
import { registerActionHandlers } from '../../src/main/ipc/handlers/actions'
import type { IpcContext } from '../../src/main/ipc/router'

type Handler = (ctx: IpcContext, arg: unknown) => unknown
const ctx = {
  configService: { loadSync: vi.fn() },
} as unknown as IpcContext

function collect(register: (add: never) => void) {
  const map = new Map<string, Handler>()
  register(((ch: string, fn: Handler) => map.set(ch, fn)) as never)
  return map
}

describe('handlers 分支补强（0.2.0）', () => {
  it('pty: 容器/可选字段/越界数字归一', async () => {
    const pty = {
      create: vi.fn(() => ({ ptyId: 'p1' })),
      createCommand: vi.fn(() => ({ ptyId: 'p2' })),
      input: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      ack: vi.fn(),
      list: vi.fn(() => []),
    }
    const wsl = { assertRunning: vi.fn(async () => {}) }
    const shell = { homeDir: vi.fn(async () => '/home/me') }
    const map = collect((add) =>
      registerPtyHandlers(add, { pty: pty as never, wsl: wsl as never, shell: shell as never }),
    )

    await map.get(CH.ptyCreate)!(ctx, {
      distro: 'U',
      containerId: 'web',
      shell: '/bin/sh',
      cwd: '/x',
      user: 'dev',
      shellIntegration: true,
      cols: -5,
      rows: 999,
    })
    expect(wsl.assertRunning).not.toHaveBeenCalled()
    expect(pty.create).toHaveBeenCalledWith(
      expect.objectContaining({
        containerId: 'web',
        shell: '/bin/sh',
        cwd: '/x',
        user: 'dev',
        shellIntegration: true,
        cols: 2,
        rows: 200,
      }),
    )

    await map.get(CH.ptyCreate)!({} as never, { distro: 'U' })
    expect(pty.create).toHaveBeenCalledWith(
      expect.objectContaining({ distro: 'U', cols: 80, rows: 24, shellIntegration: false }),
    )

    map.get(CH.ptyInput)!(ctx, { ptyId: 'p1' })
    expect(pty.input).toHaveBeenCalledWith('p1', '')
    map.get(CH.ptyResize)!(ctx, { ptyId: 'p1', cols: 90, rows: 30 })
    expect(pty.resize).toHaveBeenCalledWith('p1', 90, 30)
    map.get(CH.ptyAck)!(ctx, { ptyId: 'p1' })
    expect(pty.ack).toHaveBeenCalledWith('p1', 0)
    map.get(CH.ptyKill)!(ctx, 'p1')
    map.get(CH.ptyList)!(ctx, undefined)
    map.get(CH.ptyMaxSessions)!(ctx, undefined)
    map.get(CH.ptyHostInfo)!(ctx, undefined)
  })

  it('shell: 省略 shell 与空参数安全', async () => {
    const shell = {
      status: vi.fn(async () => ({})),
      install: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({})),
    }
    const wsl = { assertRunning: vi.fn(async () => {}) }
    const map = collect((add) =>
      registerShellHandlers(add, { shell: shell as never, wsl: wsl as never }),
    )
    await map.get(CH.shellStatus)!(ctx, undefined)
    expect(shell.status).toHaveBeenCalledWith('', undefined)
    await map.get(CH.shellInstall)!(ctx, { distro: 'U' })
    await map.get(CH.shellRemove)!(ctx, { distro: 'U', shell: '/bin/zsh' })
    expect(shell.remove).toHaveBeenCalledWith('U', '/bin/zsh')
  })

  it('containers: 可选参数缺省分支', async () => {
    const wslc: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const name of [
      'systemInfo',
      'sessionList',
      'sessionTerminate',
      'listContainers',
      'inspectContainer',
      'runContainer',
      'startContainer',
      'stopContainer',
      'restartContainer',
      'removeContainer',
      'pruneContainers',
      'logs',
      'stats',
      'copy',
      'listImages',
      'pullImage',
      'buildImage',
      'removeImage',
      'pruneImages',
      'listNetworks',
      'createNetwork',
      'removeNetwork',
      'connectNetwork',
      'disconnectNetwork',
      'pruneNetworks',
      'listVolumes',
      'createVolume',
      'removeVolume',
      'pruneVolumes',
      'readSettings',
      'writeSettings',
      'resetSettings',
    ]) {
      wslc[name] = vi.fn(async () => undefined)
    }
    wslc.capabilities = vi.fn(async () => ({}))
    const tasks = {
      start: vi.fn((opts: { run: (ctl: unknown) => Promise<void> }) => {
        void opts.run({})
        return { taskId: 't' }
      }),
    }
    const map = collect((add) =>
      registerContainerHandlers(add as never, { wslc: wslc as never, tasks: tasks as never }),
    )
    await map.get(CH.networksCreate)!(ctx, { name: 'net' })
    expect(wslc.createNetwork).toHaveBeenCalledWith('net', {})
    map.get(CH.imagesPrune)!(ctx, { all: false })
    expect(tasks.start).toHaveBeenCalledWith(expect.objectContaining({ type: 'image-prune' }))
    map.get(CH.containersRun)!(ctx, {
      image: 'ubuntu',
      ports: [],
      mounts: [],
      env: {},
      detach: true,
      rm: false,
    })
    expect(tasks.start).toHaveBeenCalledWith(
      expect.objectContaining({ lockKey: 'wslc:container:ubuntu' }),
    )
    await map.get(CH.wslcSettingsWrite)!(ctx, { content: 'x' })
    expect(wslc.writeSettings).toHaveBeenCalledWith('x')
  })
})

describe('handlers 数值/可选分支', () => {
  it('pty: cols/rows 非有限值回退默认', async () => {
    const pty = {
      create: vi.fn(() => ({ ptyId: 'p1' })),
      createCommand: vi.fn(),
      input: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      ack: vi.fn(),
      list: vi.fn(() => []),
    }
    const wsl = { assertRunning: vi.fn(async () => {}) }
    const map = collect((add) => registerPtyHandlers(add, { pty: pty as never, wsl: wsl as never }))
    await map.get(CH.ptyCreate)!(ctx, {
      distro: 'U',
      cols: Number.NaN,
      rows: Number.POSITIVE_INFINITY,
    })
    expect(pty.create).toHaveBeenCalledWith(expect.objectContaining({ cols: 80, rows: 24 }))
  })
})

describe('handlers 缺省可选参数（直接调用）', () => {
  it('shell: shell 为空串时按未指定处理', async () => {
    const shell = {
      status: vi.fn(async () => ({})),
      install: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({})),
    }
    const wsl = { assertRunning: vi.fn(async () => {}) }
    const map = collect((add) =>
      registerShellHandlers(add, { shell: shell as never, wsl: wsl as never }),
    )
    await map.get(CH.shellStatus)!(ctx, { distro: 'U', shell: '' })
    expect(shell.status).toHaveBeenCalledWith('U', '')
    await map.get(CH.shellStatus)!(ctx, null)
    expect(shell.status).toHaveBeenLastCalledWith('', undefined)
  })

  it('containers: imagesPrune 缺省 / networksCreate 全参数', async () => {
    const wslc: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const name of [
      'systemInfo',
      'sessionList',
      'sessionTerminate',
      'listContainers',
      'inspectContainer',
      'runContainer',
      'startContainer',
      'stopContainer',
      'restartContainer',
      'removeContainer',
      'pruneContainers',
      'logs',
      'stats',
      'copy',
      'listImages',
      'pullImage',
      'buildImage',
      'removeImage',
      'pruneImages',
      'listNetworks',
      'createNetwork',
      'removeNetwork',
      'connectNetwork',
      'disconnectNetwork',
      'pruneNetworks',
      'listVolumes',
      'createVolume',
      'removeVolume',
      'pruneVolumes',
      'readSettings',
      'writeSettings',
      'resetSettings',
    ])
      wslc[name] = vi.fn(async () => undefined)
    wslc.capabilities = vi.fn(async () => ({}))
    const tasks = {
      start: vi.fn((opts: { run: (ctl: unknown) => Promise<void> }) => {
        void opts.run({})
        return { taskId: 't' }
      }),
    }
    const map = collect((add) =>
      registerContainerHandlers(add as never, { wslc: wslc as never, tasks: tasks as never }),
    )
    map.get(CH.imagesPrune)!(ctx, {})
    expect(tasks.start).toHaveBeenCalledWith(expect.objectContaining({ type: 'image-prune' }))
    await map.get(CH.networksCreate)!(ctx, {
      name: 'net',
      driver: 'bridge',
      subnet: '172.18.0.0/16',
      gateway: '172.18.0.1',
    })
    expect(wslc.createNetwork).toHaveBeenCalledWith('net', {
      driver: 'bridge',
      subnet: '172.18.0.0/16',
      gateway: '172.18.0.1',
    })
  })

  it('pty profile: cols/rows 非法时回退默认', async () => {
    const cfg = {
      terminal: { profiles: [{ id: 'p', label: 'P', launch: { kind: 'distro', distro: 'U' } }] },
    }
    const ctx2 = { configService: { loadSync: () => cfg } } as unknown as IpcContext
    const pty = {
      create: vi.fn(() => ({ ptyId: 'p1' })),
      createCommand: vi.fn(),
      input: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      ack: vi.fn(),
      list: vi.fn(),
    }
    const wsl = { assertRunning: vi.fn(async () => {}) }
    const map = collect((add) => registerPtyHandlers(add, { pty: pty as never, wsl: wsl as never }))
    await map.get(CH.ptyCreateProfile)!(ctx2, { profileId: 'p', cols: Number.NaN, rows: 0 })
    expect(pty.create).toHaveBeenCalledWith(expect.objectContaining({ cols: 80, rows: 24 }))
  })
})

describe('action handler 终端/无终端分支', () => {
  it('terminal 动作 lockKey=null 并回收 PTY（任务启动失败）', async () => {
    const runner = {
      prepare: vi.fn(async () => ({
        distro: 'Ubuntu',
        action: { id: 'a', label: 'A', terminal: true },
      })),
      spawnTerminal: vi.fn(() => ({ ptyId: 'pty-1' })),
      run: vi.fn(async () => {}),
      killSession: vi.fn(),
    }
    const tasks = { start: vi.fn(() => ({ taskId: 't1' })) }
    const wsl = { assertRunning: vi.fn(async () => {}) }
    const map = collect((add) =>
      registerActionHandlers(add as never, {
        runner: runner as never,
        tasks: tasks as never,
        wsl: wsl as never,
      }),
    )
    const handle = await map.get(CH.actionRun)!(ctx, { actionId: 'a', distro: 'Ubuntu' })
    expect(tasks.start).toHaveBeenCalledWith(expect.objectContaining({ lockKey: null }))
    expect(handle).toMatchObject({ taskId: 't1', ptyId: 'pty-1' })

    tasks.start.mockImplementationOnce(() => {
      throw new Error('start failed')
    })
    await expect(map.get(CH.actionRun)!(ctx, { actionId: 'a', distro: 'Ubuntu' })).rejects.toThrow(
      'start failed',
    )
    expect(runner.killSession).toHaveBeenCalledWith('pty-1')
  })
})
