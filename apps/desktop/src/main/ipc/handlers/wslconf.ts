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
  deps: { wslconf: WslConfService; wsl: Pick<WslService, 'terminate' | 'assertRunning'> },
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
      await deps.wslconf.write(payload.name, payload.content)
      const autoStop = c.configService.loadSync('settings').wsl.autoShutdownAfterConfigChange
      if (!autoStop) return { terminated: false }
      try {
        await deps.wsl.terminate(payload.name)
        return { terminated: true }
      } catch (e) {
        // review 0.1.2 根治：文件已写成功 —— terminate 失败只影响「8 秒规则是否立即生效」，
        // 不得把整次写入当作失败（返回可读原因，由 UI 提示手动重启）
        const msg = e instanceof Error ? e.message : String(e)
        c.logger.warn('wslconf written but terminate failed', { distro: payload.name, error: msg })
        return { terminated: false, terminateError: msg }
      }
    },
  )
}
