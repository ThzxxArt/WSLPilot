/**
 * 自动更新 IPC（M7）— update:status / check / download / install。
 * 状态变更由主进程广播 `update:changed` 事件（UpdaterService.onChange 接线在 bootstrap）。
 */
import { CH, createAppError, type UpdateState } from '@wslpilot/shared'
import type { IpcContext } from '../router'

type AddFn = (channel: string, handler: (ctx: IpcContext, arg: never) => unknown) => void

function requireUpdater(ctx: IpcContext) {
  if (!ctx.updater) {
    // review 0.1.2 根治：原 UNKNOWN 语义含糊且不可行动 —— 统一 TASK_FAILED
    throw createAppError('TASK_FAILED', {
      message: '更新服务未初始化',
      suggestion: '请重启应用后重试',
    })
  }
  return ctx.updater
}

export function registerUpdateHandlers(add: AddFn, _ctx: IpcContext): void {
  /**
   * 四通道行为约定（review 0.1.2 一致化）：
   * - status 是只读展示查询：未初始化返回 idle 兜底态（UI 仍可渲染，不抛错）
   * - check / download / install 是动作：未初始化一律 TASK_FAILED（requireUpdater）
   */
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

  add(CH.updateInstall, async (c): Promise<void> => {
    requireUpdater(c).install()
  })
}
