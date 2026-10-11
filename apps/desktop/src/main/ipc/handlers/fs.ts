import { CH, type DirEntry, type FsReadResult } from '@wslpilot/shared'
import type { FsBridge } from '../../services/fs-bridge'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/** 发行版内文件（M5）：路径经 wsl.localhost 桥，路径校验在 FsBridge 内统一执行 */
export function registerFsHandlers(add: AddFn, deps: { fsBridge: FsBridge }): void {
  // 硬门禁（review：fs 走 `wsl -d X -e`，会隐式启动发行版）：未运行一律拒绝
  async function assertRunning(ctx: IpcContext, distro: string): Promise<void> {
    await ctx.wsl?.assertRunning(distro)
  }

  add(CH.fsReadDir, async (c, arg: never): Promise<DirEntry[]> => {
    const o = arg as { distro: string; path: string }
    await assertRunning(c, o.distro)
    return deps.fsBridge.readDir(o.distro, o.path)
  })

  add(CH.fsRead, async (c, arg: never): Promise<FsReadResult> => {
    const o = arg as { distro: string; path: string }
    await assertRunning(c, o.distro)
    return deps.fsBridge.read(o.distro, o.path)
  })

  add(CH.fsWrite, async (c, arg: never): Promise<void> => {
    const o = arg as { distro: string; path: string; data: string }
    await assertRunning(c, o.distro)
    await deps.fsBridge.write(o.distro, o.path, o.data)
  })

  add(CH.fsRevealInExplorer, async (_c, arg: never): Promise<void> => {
    const o = arg as { distro: string; path: string }
    await deps.fsBridge.revealInExplorer(o.distro, o.path)
  })
}
