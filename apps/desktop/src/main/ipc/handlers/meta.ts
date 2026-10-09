import { CH, createAppError, type DistroMeta } from '@wslpilot/shared'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
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
    // ★ 读-改-写放进写队列，避免并发 meta:set 丢更新（M2）
    await c.configService.update('distros', (file) => {
      const idx = file.distros.findIndex((d) => d.name === meta.name)
      const next = [...file.distros]
      if (idx >= 0) next[idx] = meta
      else next.push(meta)
      return { ...file, distros: next }
    })
    return meta
  })
}
