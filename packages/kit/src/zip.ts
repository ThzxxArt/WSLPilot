/**
 * 极简 ZIP 写入器（诊断包打包用）— 无第三方依赖。
 * - DEFLATE 压缩（异步 zlib.deflateRaw，review 0.1.2 根治：同步 deflateRawSync 会阻塞主进程）
 * - 只写不读：诊断包是一次性产物，解压由系统工具完成
 * - 文件名按 UTF-8 写入（EFS 标志位 bit 11），中文名安全
 */
import { deflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

const deflateRawAsync = promisify(deflateRaw) as (buf: Buffer) => Promise<Buffer>

/** ZIP 格式硬上限（review 0.1.2：超限必须可读报错，不得静默溢出 16/32 位字段） */
export const ZIP_MAX_ENTRIES = 0xffff
export const ZIP_MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024

/** 容量守卫（独立导出便于真实单测）：条目数 / 合计字节超 ZIP 格式上限即抛可读错误 */
export function assertZipCapacity(entryCount: number, totalBytes: number): void {
  if (entryCount > ZIP_MAX_ENTRIES) {
    throw new Error(`zip 条目数超上限（${entryCount} > ${ZIP_MAX_ENTRIES}）`)
  }
  if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
    throw new Error('zip 合计体积超 4GB 上限，无法生成')
  }
}

export interface ZipEntry {
  /** 包内路径（`/` 分隔；拒绝绝对路径与 `..` 逃逸） */
  name: string
  content: string | Buffer
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c
  }
  return table
})()

/** CRC-32（IEEE 802.3，ZIP 标准） */
export function crc32(buf: Buffer | Uint8Array): number {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  let c = -1
  for (let i = 0; i < b.length; i++) {
    c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ -1) >>> 0
}

/**
 * DOS 时间/日期（ZIP 时间戳格式）。
 * review 0.1.2 根治：DOS 日期起点是 1980 —— 早于 1980/非法日期必须 clamp 到 1980-01-01，
 * 原实现负数按位与 0x7f 会回绕成 2098 年。
 */
function dosDateTime(at: Date): { time: number; date: number } {
  let d = at
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1980) {
    d = new Date(1980, 0, 1, 0, 0, 0)
  }
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f)
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f)
  return { time, date }
}

/** 包内路径规范化：拒绝 `..` 与绝对路径（诊断包不得被用来夹带路径逃逸） */
export function assertSafeZipName(name: string): string {
  const n = String(name ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!n) throw new Error('zip 条目名不能为空')
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) {
    throw new Error(`zip 条目不允许绝对路径：${n}`)
  }
  // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
  if (/[\u0000-\u001f\u007f]/.test(n)) {
    throw new Error('zip 条目名包含非法控制字符')
  }
  if (n.split('/').some((p) => p === '..')) {
    throw new Error(`zip 条目不允许 .. 逃逸：${n}`)
  }
  return n
}

/**
 * 生成 ZIP 字节流（异步）：
 * - 条目按传入顺序写入；重名条目按 ZIP 允许（解压时后者覆盖），调用方自行保证唯一
 * - 容量守卫（review 0.1.2）：条目数 / 合计字节超 ZIP 格式上限时抛可读错误
 */
export async function createZip(
  entries: readonly ZipEntry[],
  at: Date = new Date(),
): Promise<Buffer> {
  assertZipCapacity(entries.length, 0)
  const { time, date } = dosDateTime(at)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  let totalBytes = 0

  for (const entry of entries) {
    const name = assertSafeZipName(entry.name)
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    // 容量守卫：写头部前先校验，避免 32 位 offset/尺寸字段静默溢出
    totalBytes += raw.length + nameBuf.length + 76 // 76 = local(30) + central(46) 头部合计
    assertZipCapacity(entries.length, totalBytes)
    const compressed = raw.length > 0 ? await deflateRawAsync(raw) : Buffer.alloc(0)
    const useDeflate = raw.length > 0 && compressed.length < raw.length
    const method = useDeflate ? 8 : 0
    const data = useDeflate ? compressed : raw
    const sum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags：bit 11 = UTF-8 文件名
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    locals.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // central directory header signature
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(sum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42) // local header offset
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // central dir start disk
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16) // central dir offset
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralBuf, eocd])
}
