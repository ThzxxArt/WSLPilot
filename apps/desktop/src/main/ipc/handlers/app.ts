import { app, shell } from 'electron'
import { CH } from '@wslpilot/shared'
import type { IpcContext } from '../router'

type AddFn = (channel: string, handler: (ctx: IpcContext, ...args: any[]) => Promise<unknown> | unknown) => void

export function registerAppHandlers(add: AddFn, _ctx: IpcContext): void {
  add(CH.appGetVersion, () => app.getVersion())

  add(CH.appOpenConfigDir, (c) => {
    return shell.openPath(c.configService.userDataDir)
  })
}
