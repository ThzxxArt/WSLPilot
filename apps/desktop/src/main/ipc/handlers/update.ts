/**
 * 自动更新 IPC（M7）— update:status / check / download / install。
 * 状态变更由主进程广播 `update:changed` 事件（UpdaterService.onChange 接线在 bootstrap）。
 */
import { CH, createAppError, type UpdateState } from '@wslpilot/shared'
import type { IpcContext } from '../router'

type AddFn = (channel: string, handler: (ctx: IpcContext, arg: never) => unknown) => void

function requireUpdater(ctx: IpcContext) {
  if (!ctx.updater) {
    throw createAppError('UNKNOWN', {
      message: '更新服务未初始化',
      suggestion: '请重启应用后重试',
    })
  }
  return ctx.updater
}

export function registerUpdateHandlers(add: AddFn, _ctx: IpcContext): void {
  add(CH.updateStatus, (c): UpdateState => {
    return (
      c.updater?.getState() ?? {
        status: 'idle',
        currentVersion: '',
        error: '更新服务未初始化',
      }
    )
  })

  add(CH.updateCheck, async (c): Promise<UpdateState> => requireUpdater(c).check())

  add(CH.updateDownload, async (c): Promise<UpdateState> => requireUpdater(c).download())

  add(CH.updateInstall, (c): void => {
    requireUpdater(c).install()
  })
}
