import { describe, it, expect } from 'vitest'
import { decodeToolOutput } from '../src/tool-output'

describe('decodeToolOutput', () => {
  it('空输入返回空串', () => {
    expect(decodeToolOutput(null)).toBe('')
    expect(decodeToolOutput(undefined)).toBe('')
    expect(decodeToolOutput(Buffer.alloc(0))).toBe('')
  })

  it('UTF-16LE（含 ASCII 的 NUL 结构）被识别', () => {
    const text = '请求的操作需要提升 (Run as administrator)'
    expect(decodeToolOutput(Buffer.from(text, 'utf16le'))).toBe(text)
    expect(decodeToolOutput(Buffer.from('NAME STATE VERSION', 'utf16le'))).toBe(
      'NAME STATE VERSION',
    )
    // BOM 也走 UTF-16LE 分支
    expect(decodeToolOutput(Buffer.from('\uFEFFhello', 'utf16le'))).toBe('hello')
  })

  it('严格 UTF-8 直接解码', () => {
    const text = '0.0.0.0 3000 127.0.0.1 3000'
    expect(decodeToolOutput(Buffer.from(text, 'utf8'))).toBe(text)
    const zh = '访问被拒绝'
    expect(decodeToolOutput(Buffer.from(zh, 'utf8'))).toBe(zh)
  })

  it('非 UTF-8 的 GBK 输出回退到 gbk', () => {
    // GBK 编码的「请求的操作需要提升」——不是合法 UTF-8
    const gbkBytes = Buffer.from([
      0xc7, 0xeb, 0xc7, 0xf3, 0xb5, 0xc4, 0xb2, 0xd9, 0xd7, 0xf7, 0xd0, 0xe8, 0xd2, 0xaa, 0xcc,
      0xe1, 0xc9, 0xfd,
    ])
    const out = decodeToolOutput(gbkBytes)
    expect(out).toBe('请求的操作需要提升')
  })

  it('GBK 不合法时继续降级 windows-1252（fatal 探测链 — review 根治）', () => {
    // 0x80 在 GBK 中非法（单独的引导字节），在 windows-1252 中是 €。
    // 此前非致命 GBK 解码器从不抛错，永远走不到 1252，西欧码页输出被硬解成乱码。
    expect(decodeToolOutput(Buffer.from([0x80]))).toBe('€')
  })

  it('Uint8Array 也可接受', () => {
    expect(decodeToolOutput(new Uint8Array([0x61, 0x62]))).toBe('ab')
  })

  it('BOM 优先于 NUL 启发式：纯 CJK UTF-16LE（无 NUL 结构）也能正确解码', () => {
    const text = '中文测试'
    const body = Buffer.from(text, 'utf16le')
    // 确认该内容确实没有 ASCII/NUL 结构（启发式本会失手）
    expect(body.includes(0)).toBe(false)
    const withBom = Buffer.concat([Buffer.from([0xff, 0xfe]), body])
    expect(decodeToolOutput(withBom)).toBe(text)
  })

  it('FE FF → UTF-16BE（review 0.1.2 BOM 优先）', () => {
    const text = '请求的操作需要提升'
    const le = Buffer.from(text, 'utf16le')
    const be = Buffer.alloc(le.length)
    for (let i = 0; i + 1 < le.length; i += 2) {
      be[i] = le[i + 1]!
      be[i + 1] = le[i]!
    }
    expect(decodeToolOutput(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(text)
    // 带 ASCII 的 BE 输出
    const asciiBe = Buffer.from([0xfe, 0xff, 0x00, 0x4e, 0x00, 0x41, 0x00, 0x4d, 0x00, 0x45])
    expect(decodeToolOutput(asciiBe)).toBe('NAME')
  })

  it('非 UTF-16 文本中的合法 NUL 不被删除（NUL 清理只在 UTF-16 判命中后）', () => {
    // 位置结构不满足 UTF-16LE 启发式（偶数位 NUL 多于奇数位），走严格 UTF-8
    const buf = Buffer.from([0x61, 0x62, 0x00, 0x63])
    expect(decodeToolOutput(buf)).toBe('ab\u0000c')
  })

  it('UTF-8 BOM 被剥离', () => {
    expect(decodeToolOutput(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi')
  })
})
