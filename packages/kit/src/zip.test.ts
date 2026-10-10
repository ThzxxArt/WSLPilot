import { describe, it, expect } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import { assertSafeZipName, createZip, crc32 } from './zip'

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

  it('生成可解析的 zip：条目名/内容/压缩往返', () => {
    const zip = createZip([
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

  it('空条目与空列表合法', () => {
    const empty = createZip([])
    expect(empty.readUInt32LE(empty.length - 22)).toBe(0x06054b50)
    const one = createZip([{ name: 'a.txt', content: '' }])
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

  it('createZip 复用安全校验', () => {
    expect(() => createZip([{ name: '../x', content: 'y' }])).toThrow()
  })
})
