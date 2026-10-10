/**
 * 极简 ZIP 写入器（诊断包打包用）— 无第三方依赖。
 * - DEFLATE 压缩（zlib.deflateRawSync）+ CRC32
 * - 只写不读：诊断包是一次性产物，解压由系统工具完成
 * - 文件名按 UTF-8 写入（EFS 标志位 bit 11），中文名安全
 */
import { deflateRawSync } from 'node:zlib'

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

/** DOS 时间/日期（ZIP 时间戳格式） */
function dosDateTime(at: Date): { time: number; date: number } {
  const time =
    ((at.getHours() & 0x1f) << 11) |
    ((at.getMinutes() & 0x3f) << 5) |
    ((at.getSeconds() / 2) & 0x1f)
  const date =
    (((at.getFullYear() - 1980) & 0x7f) << 9) |
    (((at.getMonth() + 1) & 0x0f) << 5) |
    (at.getDate() & 0x1f)
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
 * 生成 ZIP 字节流。
 * 条目按传入顺序写入；重名条目按 ZIP 允许（解压时后者覆盖），调用方自行保证唯一。
 */
export function createZip(entries: readonly ZipEntry[], at: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(at)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = assertSafeZipName(entry.name)
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const compressed = raw.length > 0 ? deflateRawSync(raw) : Buffer.alloc(0)
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
