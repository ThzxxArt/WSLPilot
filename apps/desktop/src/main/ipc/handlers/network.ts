import { CH, type NetworkStatus, type ProxyScriptState, type TaskHandle } from '@wslpilot/shared'
import type { NetworkService } from '../../services/network-service'
import type { TaskRunner } from '../../services/task-runner'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/**
 * 网络（M6）：声明式端口转发 + 镜像模式检测 + 代理落盘。
 * - apply / applyAll / remove 是长任务 → TaskHandle，进度走 task:progress，netsh 写类串行锁
 * - 规则 id 只是 network.jsonc 的白名单键，参数永不直接进入命令行
 * - 提权类失败由 NetworkService 映射为 PERMISSION_DENIED（ElevationHelper 属 M7）
 */
export function registerNetworkHandlers(
  add: AddFn,
  deps: { network: NetworkService; tasks: TaskRunner },
): void {
  const { network, tasks } = deps

  add(CH.networkStatus, async (): Promise<NetworkStatus> => network.status())

  add(CH.networkApply, (_c, arg: never): TaskHandle => {
    const id = String(arg)
    return tasks.start({
      type: 'network',
      message: `应用转发规则 ${id}`,
      // netsh portproxy 是全局写操作，必须串行（防止互相覆盖）
      lockKey: 'network:portproxy',
      run: (ctl) => network.applyRule(id, ctl),
    })
  })

  add(CH.networkApplyAll, (): TaskHandle => {
    return tasks.start({
      type: 'network',
      message: '应用全部转发规则',
      lockKey: 'network:portproxy',
      run: (ctl) => network.applyAll(ctl),
    })
  })

  add(CH.networkRemove, (_c, arg: never): TaskHandle => {
    const id = String(arg)
    return tasks.start({
      type: 'network',
      message: `移除转发 ${id}`,
      lockKey: 'network:portproxy',
      run: (ctl) => network.removeRule(id, ctl),
    })
  })

  add(CH.networkProxyApply, async (_c, arg: never): Promise<{ distro: string }> => {
    const o = arg as { distro: string }
    await network.proxyApply(o.distro)
    return { distro: o.distro }
  })

  add(CH.networkProxyClear, async (_c, arg: never): Promise<{ distro: string }> => {
    const o = arg as { distro: string }
    await network.proxyClear(o.distro)
    return { distro: o.distro }
  })

  add(CH.networkProxyState, async (_c, arg: never): Promise<ProxyScriptState> => {
    const o = arg as { distro: string }
    return network.proxyState(o.distro)
  })
}
