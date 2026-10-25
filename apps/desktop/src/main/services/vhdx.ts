/**
 * VHDX 虚拟容量读取（0.1.4 resize 安全门禁用）。
 *
 * WSL 的 `--resize` 并不因缺少 `--allow-unsafe` 就只扩容：3.0.3 的
 * `ResizeDistribution()` 在目标小于当前文件系统时会缩小文件系统与 VHD。
 * 要兑现“只扩容”，必须自己读当前**虚拟容量**（不是宿主文件物理大小），
 * 目标 <= 当前值一律拒绝，而不是把用户输入直接交给 wsl。
 *
 * VHDX 规范（固定位置）：
 * - 0: 8 字节 `vhdxfile`
 * - 192KiB: 区域表头 `regi` + count + entries（32B/条）
 * - 区域表 metadata GUID → 元数据区域
 * - 元数据区域头 `metadata` + count（offset 10）+ entries（32B/条）
 * - `Virtual Disk Size` 项（GUID 2442A52F-1BCD-7648-B211-5DBED83BF4B8）8 字节 LE
 */
import { open } from 'node:fs/promises'

const REGION_OFFSET = 192 * 1024
const REGION_ENTRY_SIZE = 32
const METADATA_ENTRY_SIZE = 32
const MAX_REGION_ENTRIES = 2048
const MAX_METADATA_ENTRIES = 2048
/** 原始字节序（VHDX 的 GUID 在磁盘上不是字符串顺序） */
const METADATA_REGION_GUID = '06A27C8B90479A4BB8FE575F050F886E'
const VIRTUAL_SIZE_GUID = '2442A52F1BCD7648B2115DBED83BF4B8'

async function readAt(
  handle: Awaited<ReturnType<typeof open>>,
  position: number,
  length: number,
): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buf, 0, length, position)
  return buf.subarray(0, bytesRead)
}

/**
 * 读取 VHDX 虚拟容量（字节）。格式不完整/不是 VHDX/字段异常返回 undefined，
 * 调用方必须把它当作“无法保证安全”并拒绝破坏性 resize。
 */
export async function readVhdxVirtualSize(filePath: string): Promise<number | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, 'r')
    const magic = await readAt(handle, 0, 8)
    if (magic.toString('ascii') !== 'vhdxfile') return undefined

    const regionHeader = await readAt(handle, REGION_OFFSET, 16)
    if (regionHeader.subarray(0, 4).toString('ascii') !== 'regi') return undefined
    const regionCount = regionHeader.readUInt32LE(8)
    if (regionCount === 0 || regionCount > MAX_REGION_ENTRIES) return undefined

    let metadataOffset: number | undefined
    for (let i = 0; i < regionCount; i++) {
      const entry = await readAt(
        handle,
        REGION_OFFSET + 16 + i * REGION_ENTRY_SIZE,
        REGION_ENTRY_SIZE,
      )
      if (entry.length < REGION_ENTRY_SIZE) return undefined
      if (entry.subarray(0, 16).toString('hex').toUpperCase() === METADATA_REGION_GUID) {
        const off = entry.readBigUInt64LE(16)
        if (off > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
        metadataOffset = Number(off)
        break
      }
    }
    if (metadataOffset === undefined) return undefined

    const metadataHeader = await readAt(handle, metadataOffset, 32)
    if (metadataHeader.subarray(0, 8).toString('ascii') !== 'metadata') return undefined
    const metadataCount = metadataHeader.readUInt16LE(10)
    if (metadataCount === 0 || metadataCount > MAX_METADATA_ENTRIES) return undefined

    for (let i = 0; i < metadataCount; i++) {
      const entry = await readAt(
        handle,
        metadataOffset + 32 + i * METADATA_ENTRY_SIZE,
        METADATA_ENTRY_SIZE,
      )
      if (entry.length < METADATA_ENTRY_SIZE) return undefined
      if (entry.subarray(0, 16).toString('hex').toUpperCase() !== VIRTUAL_SIZE_GUID) continue
      const offset = entry.readUInt32LE(16)
      const length = entry.readUInt32LE(20)
      if (length < 8) return undefined
      const raw = await readAt(handle, metadataOffset + offset, 8)
      if (raw.length < 8) return undefined
      const size = raw.readBigUInt64LE(0)
      if (size <= 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
      return Number(size)
    }
    return undefined
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => {})
  }
}
