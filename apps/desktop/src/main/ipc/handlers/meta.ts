import { CH, type DistroMeta } from '@wslpilot/shared'
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
      throw new Error('缺少发行版名称')
    }
    const file = await c.configService.load('distros')
    const idx = file.distros.findIndex((d) => d.name === meta.name)
    const next = [...file.distros]
    if (idx >= 0) next[idx] = meta
    else next.push(meta)
    await c.configService.replace('distros', { ...file, distros: next })
    return meta
  })
}
