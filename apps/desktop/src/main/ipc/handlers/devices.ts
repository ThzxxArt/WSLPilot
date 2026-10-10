import { CH, type TaskHandle, type UsbDevice, type UsbipdStatus } from '@wslpilot/shared'
import type { UsbipdService } from '../../services/usbipd-service'
import type { TaskRunner } from '../../services/task-runner'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/**
 * USB 设备（M6 usbipd，可选）：list / bind / unbind / attach / detach。
 * - bind / unbind 需管理员权限 → 长任务（日志 + 等价命令行），usbipd 写类串行锁
 * - attach / detach 快速命令（usbipd 2.x 无需提权）→ 直接返回
 * - usbipd 未安装由 UsbipdService 给出 winget 安装引导，不阻断其它功能
 */
export function registerDeviceHandlers(
  add: AddFn,
  deps: { devices: UsbipdService; tasks: TaskRunner },
): void {
  const { devices, tasks } = deps

  add(CH.devicesStatus, async (): Promise<UsbipdStatus> => devices.status())

  add(CH.devicesList, async (): Promise<UsbDevice[]> => devices.list())

  add(CH.devicesBind, (_c, arg: never): TaskHandle => {
    const busId = String(arg)
    return tasks.start({
      type: 'device',
      message: `绑定设备 ${busId}`,
      lockKey: 'usbipd',
      run: (ctl) => devices.bind(busId, ctl),
    })
  })

  add(CH.devicesUnbind, (_c, arg: never): TaskHandle => {
    const busId = String(arg)
    return tasks.start({
      type: 'device',
      message: `解除绑定 ${busId}`,
      lockKey: 'usbipd',
      run: (ctl) => devices.unbind(busId, ctl),
    })
  })

  add(CH.devicesAttach, async (_c, arg: never): Promise<void> => {
    const o = arg as { busId: string; distro?: string }
    await devices.attach(o.busId, o.distro)
  })

  add(CH.devicesDetach, async (_c, arg: never): Promise<void> => {
    await devices.detach(String(arg))
  })
}
