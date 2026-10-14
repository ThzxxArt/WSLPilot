import { CH, type WslConfigFileState } from '@wslpilot/shared'
import type { WslConfigService } from '../../services/wslconfig-service'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/**
 * `%UserProfile%\.wslconfig` 读写（0.1.3 全局配置编辑）。
 * 写盘为纯宿主文件操作（备份 + 原子写），生效需 `wsl --shutdown`（UI 提供一键入口）。
 */
export function registerWslConfigHandlers(add: AddFn, deps: { wslconfig: WslConfigService }): void {
  add(CH.wslconfigRead, async (): Promise<WslConfigFileState> => {
    return deps.wslconfig.read()
  })

  add(CH.wslconfigWrite, async (_c, arg: never): Promise<{ path: string }> => {
    const o = arg as { content: string }
    return deps.wslconfig.write(o.content)
  })
}
