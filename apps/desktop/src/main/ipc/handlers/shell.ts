import { CH } from '@wslpilot/shared'
import type { ShellIntegrationService } from '../../services/shell-integration-service'
import type { WslService } from '../../services/wsl-service'
import type { IpcContext } from '../router'

type AddFn = (channel: string, handler: (ctx: IpcContext, arg: never) => unknown) => void

export interface ShellHandlerDeps {
  shell: ShellIntegrationService
  wsl: Pick<WslService, 'assertRunning'>
}

export function registerShellHandlers(add: AddFn, deps: ShellHandlerDeps): void {
  const read = (arg: unknown) => {
    const o = (arg ?? {}) as { distro?: string; shell?: string }
    return { distro: String(o.distro ?? ''), shell: o.shell }
  }

  add(CH.shellStatus, async (_c, arg: never) => {
    const o = read(arg)
    await deps.wsl.assertRunning(o.distro)
    return deps.shell.status(o.distro, o.shell)
  })

  add(CH.shellInstall, async (_c, arg: never) => {
    const o = read(arg)
    await deps.wsl.assertRunning(o.distro)
    return deps.shell.install(o.distro, o.shell)
  })

  add(CH.shellRemove, async (_c, arg: never) => {
    const o = read(arg)
    await deps.wsl.assertRunning(o.distro)
    return deps.shell.remove(o.distro, o.shell)
  })
}
