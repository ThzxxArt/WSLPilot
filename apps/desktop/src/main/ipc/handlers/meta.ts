import { CH, createAppError, type DistroMeta } from '@wslpilot/shared'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  handler: (ctx: IpcContext, ...args: any[]) => Promise<unknown> | unknown,
) => void

export function registerMetaHandlers(add: AddFn): void {
  add(CH.metaGet, async (c, name: string) => {
    const file = await c.configService.load('distros')
    return file.distros.find((d) => d.name === name) ?? null
  })

  add(CH.metaSet, async (c, meta: DistroMeta) => {
    if (!meta || typeof meta.name !== 'string' || !meta.name.trim()) {
      throw createAppError('CONFIG_INVALID', { message: '缺少发行版名称' })
    }
    const file = await c.configService.load('distros')
    const idx = file.distros.findIndex((d) => d.name === meta.name)
    const next = [...file.distros]
    if (idx >= 0) next[idx] = meta
    else next.push(meta)
    // ★ 用 patch 而非 replace：数组整体作为叶子替换，保留文件其余注释
    await c.configService.patch('distros', { distros: next } as any)
    return meta
  })
}
