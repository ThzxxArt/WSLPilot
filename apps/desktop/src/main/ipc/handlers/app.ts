import { app, shell } from 'electron'
import { CH } from '@wslpilot/shared'
import type { IpcContext } from '../router'

type AddFn = (channel: string, handler: (ctx: IpcContext, ...args: any[]) => Promise<unknown> | unknown) => void

export function registerAppHandlers(add: AddFn, _ctx: IpcContext): void {
  add(CH.appGetVersion, () => app.getVersion())

  add(CH.appOpenConfigDir, (c) => {
    return shell.openPath(c.configService.userDataDir)
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
    // 交给主进程 close 事件决定：最小化到托盘 或 退出
    win.close()
  })
}
