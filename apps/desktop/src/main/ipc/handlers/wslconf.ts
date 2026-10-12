import { CH, type WslConfWriteResult } from '@wslpilot/shared'
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
  deps: { wslconf: WslConfService; wsl: Pick<WslService, 'assertRunning'> },
): void {
  add(CH.wslconfRead, async (_c, name: string) => {
    // 硬门禁（review：`wsl -d X -e cat` 会隐式启动发行版）：未运行不读
    await deps.wsl.assertRunning(name)
    return deps.wslconf.read(name)
  })

  add(
    CH.wslconfWrite,
    async (c, payload: { name: string; content: string }): Promise<WslConfWriteResult> => {
      await deps.wsl.assertRunning(payload.name)
      const autoStop = c.configService.loadSync('settings').wsl.autoShutdownAfterConfigChange
      // review 0.1.2 审计修复：terminate 此前在 per-distro 写队列之外，并发保存会落在
      // 另一次写的 terminate 窗口内。现由 wslconf 服务在同一队列内执行 写→terminate，
      // 保证 写1→terminate1→写2 严格有序；terminate 失败不回滚写入（服务内返回 terminateError）。
      return deps.wslconf.writeAndMaybeTerminate(payload.name, payload.content, autoStop)
    },
  )
}
