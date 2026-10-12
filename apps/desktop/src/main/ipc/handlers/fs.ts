import { CH, type DirEntry, type FsReadResult } from '@wslpilot/shared'
import type { FsBridge } from '../../services/fs-bridge'
import type { WslService } from '../../services/wsl-service'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/** 发行版内文件（M5）：路径经 wsl.localhost 桥，路径校验在 FsBridge 内统一执行 */
export function registerFsHandlers(
  add: AddFn,
  deps: { fsBridge: FsBridge; wsl: Pick<WslService, 'assertRunning'> },
): void {
  // 硬门禁（review：fs 走 `wsl -d X -e`，会隐式启动发行版）：未运行一律拒绝。
  // review 0.1.2 根治：wsl 改为必填依赖 —— `ctx.wsl?.` 在装配缺失时静默放行门禁，
  // 四个通道（含 revealInExplorer）现全部经此唯一入口
  const assertRunning = (distro: string) => deps.wsl.assertRunning(distro)

  add(CH.fsReadDir, async (_c, arg: never): Promise<DirEntry[]> => {
    const o = arg as { distro: string; path: string }
    await assertRunning(o.distro)
    return deps.fsBridge.readDir(o.distro, o.path)
  })

  add(CH.fsRead, async (_c, arg: never): Promise<FsReadResult> => {
    const o = arg as { distro: string; path: string }
    await assertRunning(o.distro)
    return deps.fsBridge.read(o.distro, o.path)
  })

  add(CH.fsWrite, async (_c, arg: never): Promise<void> => {
    const o = arg as { distro: string; path: string; data: string }
    await assertRunning(o.distro)
    await deps.fsBridge.write(o.distro, o.path, o.data)
  })

  // revealInExplorer 同样经发行版内路径桥（`wsl -d X -e` 校验存在性），必须过门禁
  add(CH.fsRevealInExplorer, async (_c, arg: never): Promise<void> => {
    const o = arg as { distro: string; path: string }
    await assertRunning(o.distro)
    await deps.fsBridge.revealInExplorer(o.distro, o.path)
  })
}
