import { app, shell } from 'electron'
import { CH } from '@wslpilot/shared'
import type { IpcContext } from '../router'

type AddFn = (channel: string, // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown) => void

export function registerAppHandlers(add: AddFn, _ctx: IpcContext): void {
  add(CH.appGetVersion, () => app.getVersion())

  add(CH.appOpenConfigDir, (c) => {
    return shell.openPath(c.configService.userDataDir)
  })

  add(CH.appGetWslVersion, async (c) => {
    if (!c.wsl) return { wslVersion: '', kernelVersion: '' }
    return c.wsl.getVersion()
  })

  add(CH.appWindowMinimize, (c) => {
    c.getMainWindow()?.minimize()
  })

  add(CH.appWindowMaximize, (c) => {
    const win = c.getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  add(CH.appWindowClose, (c) => {
    const win = c.getMainWindow()
    if (!win) return
    win.close()
  })
}
