import { describe, it, expect } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import {
  assertSafeZipName,
  assertZipCapacity,
  createZip,
  crc32,
  ZIP_MAX_ENTRIES,
  ZIP_MAX_TOTAL_BYTES,
} from './zip'

/** 最小 zip 读取器（仅测试用）：解析 local file header + 数据 */
function readZipEntries(buf: Buffer): Array<{ name: string; content: Buffer; method: number }> {
  const out: Array<{ name: string; content: Buffer; method: number }> = []
  let offset = 0
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8)
    const csize = buf.readUInt32LE(offset + 18)
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    const dataStart = offset + 30 + nameLen + extraLen
    const raw = buf.subarray(dataStart, dataStart + csize)
    out.push({
      name,
      content: method === 8 ? inflateRawSync(raw) : Buffer.from(raw),
      method,
    })
    offset = dataStart + csize
  }
  return out
}

describe('zip 写入器（M7 诊断包）', () => {
  it('crc32 标准向量', () => {
    // "123456789" 的 CRC-32 = 0xCBF43926
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })

  it('生成可解析的 zip：条目名/内容/压缩往返', async () => {
    const zip = await createZip([
      { name: 'manifest.json', content: '{"a":1}' },
      { name: 'logs/app-20261010.log', content: 'hello 日志\n'.repeat(50) },
      { name: 'config/settings.jsonc', content: Buffer.from('binary\u0000data') },
    ])
    // 末尾 EOCD 签名
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50)
    const entries = readZipEntries(zip)
    expect(entries.map((e) => e.name)).toEqual([
      'manifest.json',
      'logs/app-20261010.log',
      'config/settings.jsonc',
    ])
    expect(entries[0]!.content.toString('utf8')).toBe('{"a":1}')
    expect(entries[1]!.content.toString('utf8')).toBe('hello 日志\n'.repeat(50))
    expect(entries[2]!.content.equals(Buffer.from('binary\u0000data'))).toBe(true)
    // 大内容应走 DEFLATE（method 8）
    expect(entries[1]!.method).toBe(8)
  })

  it('空条目与空列表合法', async () => {
    const empty = await createZip([])
    expect(empty.readUInt32LE(empty.length - 22)).toBe(0x06054b50)
    const one = await createZip([{ name: 'a.txt', content: '' }])
    const entries = readZipEntries(one)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.content.length).toBe(0)
    expect(entries[0]!.method).toBe(0)
  })

  it('拒绝路径逃逸与绝对路径（诊断包不得夹带路径）', () => {
    expect(() => assertSafeZipName('../evil')).toThrow(/逃逸/)
    expect(() => assertSafeZipName('a/../../b')).toThrow(/逃逸/)
    expect(() => assertSafeZipName('/etc/passwd')).toThrow(/绝对路径/)
    expect(() => assertSafeZipName('C:\\Windows\\system32')).toThrow(/绝对路径/)
    expect(() => assertSafeZipName('')).toThrow(/不能为空/)
    expect(() => assertSafeZipName('a\u0000b')).toThrow(/控制字符/)
    expect(assertSafeZipName('logs\\app.log')).toBe('logs/app.log')
  })

  it('createZip 复用安全校验', async () => {
    await expect(createZip([{ name: '../x', content: 'y' }])).rejects.toThrow()
  })

  it('容量守卫：条目数 / 合计字节超 ZIP 上限时抛可读错误（不静默溢出）', async () => {
    expect(() => assertZipCapacity(ZIP_MAX_ENTRIES + 1, 0)).toThrow(/条目数超上限/)
    expect(() => assertZipCapacity(1, ZIP_MAX_TOTAL_BYTES + 1)).toThrow(/4GB/)
    expect(() => assertZipCapacity(ZIP_MAX_ENTRIES, ZIP_MAX_TOTAL_BYTES)).not.toThrow()
    // createZip 入口即拦（不进入压缩循环）
    const tooMany = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({
      name: `f${i}.txt`,
      content: '',
    }))
    await expect(createZip(tooMany)).rejects.toThrow(/条目数超上限/)
  })

  it('DOS 日期早于 1980 时 clamp 到 1980-01-01（不回绕成 2098）', async () => {
    const zip = await createZip([{ name: 'a.txt', content: 'x' }], new Date('1970-01-01T00:00:00Z'))
    // local header date 字段在 offset 12；1980-01-01 → ((0)<<9)|((1)<<5)|1 = 0x21
    expect(zip.readUInt16LE(12)).toBe(0x21)
    // 正常日期不被 clamp
    const zip2 = await createZip([{ name: 'a.txt', content: 'x' }], new Date(2026, 9, 10, 12, 0, 0))
    expect(zip2.readUInt16LE(12)).toBe((((2026 - 1980) & 0x7f) << 9) | (10 << 5) | 10)
  })
})
