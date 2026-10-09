import { CH, type TaskHandle } from '@wslpilot/shared'
import type { ActionRunner } from '../../services/action-runner'
import { actionTaskHandle } from '../../services/action-runner'
import type { TaskRunner } from '../../services/task-runner'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/**
 * 自定义动作（M5）：只执行 actions.jsonc 白名单内的动作 id。
 * - terminal:true → 复用临时 PTY，ptyId 随 TaskHandle 返回（渲染层挂到终端工作区）
 * - terminal:false → spawn 流式任务，日志进 task:progress
 * 确认（confirm）由渲染层负责（与 distros:unregister 同一模式）。
 */
export function registerActionHandlers(
  add: AddFn,
  deps: { runner: ActionRunner; tasks: TaskRunner },
): void {
  add(CH.actionRun, async (_c, arg: never): Promise<TaskHandle> => {
    const o = arg as { actionId: string; distro?: string }
    const prepared = await deps.runner.prepare(o.actionId, o.distro)
    const info = prepared.action.terminal ? deps.runner.spawnTerminal(prepared) : null
    try {
      const handle = deps.tasks.start({
        type: 'action',
        distro: prepared.distro,
        message: `动作：${prepared.action.label}`,
        // 终端动作不加锁（互不阻塞）；headless 动作按发行版串行（写类安全）
        lockKey: prepared.action.terminal ? null : prepared.distro.toLowerCase(),
        run: (ctl) => deps.runner.run(prepared, ctl, info?.ptyId),
      })
      return actionTaskHandle(handle.taskId, info, prepared.distro)
    } catch (e) {
      // 任务启动失败必须回收已建的临时 PTY，杜绝孤儿会话
      if (info) deps.runner.killSession(info.ptyId)
      throw e
    }
  })
}
