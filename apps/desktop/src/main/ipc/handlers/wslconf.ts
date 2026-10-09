import { CH } from '@wslpilot/shared'
import type { WslConfService } from '../../services/wslconf-service'
import type { WslService } from '../../services/wsl-service'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/**
 * wsl.conf 读写（M5 配置与动作）。
 * write 成功后按 settings.wsl.autoShutdownAfterConfigChange 决定是否
 * terminate 该发行版（8 秒规则：完全停止后配置才生效）。
 */
export function registerWslConfHandlers(
  add: AddFn,
  deps: { wslconf: WslConfService; wsl: Pick<WslService, 'terminate'> },
): void {
  add(CH.wslconfRead, async (_c, name: string) => {
    return deps.wslconf.read(name)
  })

  add(
    CH.wslconfWrite,
    async (c, payload: { name: string; content: string }): Promise<{ terminated: boolean }> => {
      await deps.wslconf.write(payload.name, payload.content)
      const autoStop = c.configService.loadSync('settings').wsl.autoShutdownAfterConfigChange
      if (autoStop) {
        await deps.wsl.terminate(payload.name)
        return { terminated: true }
      }
      return { terminated: false }
    },
  )
}
