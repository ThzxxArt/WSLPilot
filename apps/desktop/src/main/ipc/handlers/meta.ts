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
    // WSL 发行版名不区分大小写：按 toLowerCase 归一比较（否则换大小写查询会 miss）
    const key = String(name ?? '').toLowerCase()
    return file.distros.find((d) => d.name.toLowerCase() === key) ?? null
  })

  add(CH.metaSet, async (c, meta: DistroMeta) => {
    if (!meta || typeof meta.name !== 'string' || !meta.name.trim()) {
      throw createAppError('CONFIG_INVALID', { message: '缺少发行版名称' })
    }
    // ★ 读-改-写放进写队列，避免并发 meta:set 丢更新（M2）
    await c.configService.update('distros', (file) => {
      // 大小写归一比较：换大小写写入命中同一条目，不产生重复；
      // 命中后写回保留 meta.name 原样（显示形态由调用方决定）
      const key = meta.name.toLowerCase()
      const idx = file.distros.findIndex((d) => d.name.toLowerCase() === key)
      const next = [...file.distros]
      if (idx >= 0) next[idx] = meta
      else next.push(meta)
      return { ...file, distros: next }
    })
    return meta
  })
}
