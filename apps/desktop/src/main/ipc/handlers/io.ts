import {
  CH,
  type BackupFileInfo,
  type IoExportRequest,
  type IoImportRequest,
  type IoMoveRequest,
  type TaskHandle,
} from '@wslpilot/shared'
import type { IoService } from '../../services/io-service'
import type { TaskRunner } from '../../services/task-runner'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/**
 * M4 备份迁移 IO 通道（设计书 §8.1 io:* / task:*）：
 * export / import / move 均为长任务 → 立即返回 TaskHandle，
 * 进度经 `task:progress` 事件推送，`task:cancel` 可取消。
 * 同一发行版的写类任务由 TaskRunner lockKey 串行化。
 */
export function registerIoHandlers(add: AddFn, deps: { io: IoService; tasks: TaskRunner }): void {
  const { io, tasks } = deps

  add(CH.ioExport, (_c, arg: never): TaskHandle => {
    const o = arg as IoExportRequest
    return tasks.start({
      type: 'export',
      distro: o.name,
      message: `导出 ${o.name}`,
      // 发行版名不区分大小写，锁键必须归一（review M11）
      lockKey: o.name.toLowerCase(),
      run: (ctl) => io.runExport(o, ctl).then(() => undefined),
    })
  })

  add(CH.ioImport, (_c, arg: never): TaskHandle => {
    const o = arg as IoImportRequest
    return tasks.start({
      type: 'import',
      distro: o.name,
      message: `导入 ${o.name}`,
      lockKey: o.name.toLowerCase(),
      run: (ctl) => io.runImport(o, ctl),
    })
  })

  add(CH.ioMove, (_c, arg: never): TaskHandle => {
    const o = arg as IoMoveRequest
    return tasks.start({
      type: 'move',
      distro: o.name,
      message: `迁移 ${o.name}`,
      lockKey: o.name.toLowerCase(),
      run: (ctl) => io.runMove(o, ctl),
    })
  })

  add(CH.ioListBackups, async (_c, arg: never): Promise<BackupFileInfo[]> => {
    const o = (arg ?? {}) as { dir?: string }
    return io.listBackups(o.dir)
  })

  add(CH.ioCleanupBackups, async (_c, arg: never): Promise<{ removed: number }> => {
    const o = (arg ?? {}) as { dir?: string; keep?: number }
    return io.cleanupBackups(o.dir, typeof o.keep === 'number' ? o.keep : 5)
  })

  add(CH.taskCancel, (_c, taskId: never): boolean => {
    return tasks.cancel(String(taskId))
  })
}
