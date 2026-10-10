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

  it('Uint8Array 也可接受', () => {
    expect(decodeToolOutput(new Uint8Array([0x61, 0x62]))).toBe('ab')
  })
})
