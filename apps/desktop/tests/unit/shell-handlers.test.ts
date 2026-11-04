import { describe, it, expect, vi } from 'vitest'
import { CH } from '@wslpilot/shared'
import { registerShellHandlers } from '../../src/main/ipc/handlers/shell'
import type { IpcContext } from '../../src/main/ipc/router'

type Handler = (ctx: IpcContext, arg: unknown) => unknown

function setup() {
  const handlers = new Map<string, Handler>()
  const shell = {
    status: vi.fn(async () => ({ state: 'missing' })),
    install: vi.fn(async () => ({ state: 'installed' })),
    remove: vi.fn(async () => ({ state: 'missing' })),
    homeDir: vi.fn(async () => '/home/me'),
    invalidateCache: vi.fn(),
  }
  const wsl = { assertRunning: vi.fn(async () => {}) }
  registerShellHandlers(((ch: string, fn: Handler) => handlers.set(ch, fn)) as never, {
    shell: shell as never,
    wsl: wsl as never,
  })
  return { handlers, shell, wsl }
}

const ctx = {} as IpcContext

describe('Shell 集成 IPC handlers', () => {
  it('status / install / remove 均先过发行版运行门禁并透传 shell', async () => {
    const { handlers, shell, wsl } = setup()
    await handlers.get(CH.shellStatus)!(ctx, { distro: 'Ubuntu', shell: '/bin/zsh' })
    expect(wsl.assertRunning).toHaveBeenCalledWith('Ubuntu')
    expect(shell.status).toHaveBeenCalledWith('Ubuntu', '/bin/zsh')

    await handlers.get(CH.shellInstall)!(ctx, { distro: 'Ubuntu' })
    expect(wsl.assertRunning).toHaveBeenCalledTimes(2)
    expect(shell.install).toHaveBeenCalledWith('Ubuntu', undefined)

    await handlers.get(CH.shellRemove)!(ctx, { distro: 'Debian', shell: '/bin/bash' })
    expect(wsl.assertRunning).toHaveBeenCalledTimes(3)
    expect(shell.remove).toHaveBeenCalledWith('Debian', '/bin/bash')
  })

  it('发行版未运行：门禁拒绝，不触碰文件系统', async () => {
    const { handlers, shell } = setup()
    const wsl = { assertRunning: vi.fn(async () => Promise.reject(new Error('not running'))) }
    const handlers2 = new Map<string, Handler>()
    registerShellHandlers(((ch: string, fn: Handler) => handlers2.set(ch, fn)) as never, {
      shell: shell as never,
      wsl: wsl as never,
    })
    await expect(handlers2.get(CH.shellInstall)!(ctx, { distro: 'Ubuntu' })).rejects.toThrow(
      'not running',
    )
    expect(shell.install).not.toHaveBeenCalled()
    expect(handlers.has(CH.shellStatus)).toBe(true)
  })
})
