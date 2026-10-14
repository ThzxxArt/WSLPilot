/**
 * 宿主磁盘占用读取（0.1.3 链路补齐）—— `<BasePath>\ext4.vhdx` 的文件大小。
 *
 * - 纯查询：只读元数据，绝不启动发行版、绝不读取内部数据
 * - 失败降级 `undefined`（WSL1 无 ext4.vhdx / 路径不存在 / 权限不足），不阻断列表
 * - 30s TTL 缓存：`distros:list` 5s 轮询下不重复打文件系统（stat 是廉价元数据操作，
 *   但按「一次查询一组」节流更稳）
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const HOST_DISK_TTL_MS = 30_000

export interface HostDiskReaderDeps {
  /** 注入实现（测试）；默认 node:fs/promises.stat */
  stat?: (path: string) => Promise<{ size: number }>
  now?: () => number
}

export interface HostDiskReader {
  /** 返回 ext4.vhdx 字节数；不可得返回 undefined（含缓存） */
  read(basePath: string | undefined): Promise<number | undefined>
}

export function createHostDiskReader(deps: HostDiskReaderDeps = {}): HostDiskReader {
  const stat = deps.stat ?? ((p: string) => fs.stat(p))
  const now = deps.now ?? Date.now
  const cache = new Map<string, { at: number; size: number | undefined }>()

  return {
    async read(basePath: string | undefined): Promise<number | undefined> {
      const base = String(basePath ?? '').trim()
      if (!base) return undefined
      const hit = cache.get(base)
      if (hit && now() - hit.at < HOST_DISK_TTL_MS) return hit.size
      let size: number | undefined
      try {
        size = (await stat(join(base, 'ext4.vhdx'))).size
      } catch {
        size = undefined
      }
      cache.set(base, { at: now(), size })
      return size
    },
  }
}
