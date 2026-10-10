import { describe, it, expect } from 'vitest'
import {
  chunkTerminalInput,
  PTY_INPUT_MAX_BYTES,
} from '../../src/renderer/features/terminal/input-chunk'

describe('终端输入分片（IPC 256KB 上限）', () => {
  it('小输入单片透传', () => {
    expect(chunkTerminalInput('ls -la\n')).toEqual(['ls -la\n'])
    expect(chunkTerminalInput('')).toEqual([''])
  })

  it('超限输入按 UTF-8 字节切分，每片不超上限', () => {
    // 1 字节/字符
    const data = 'a'.repeat(PTY_INPUT_MAX_BYTES + 100)
    const chunks = chunkTerminalInput(data)
    expect(chunks.length).toBe(2)
    expect(chunks.join('')).toBe(data)
    for (const c of chunks) {
      expect(new TextEncoder().encode(c).length).toBeLessThanOrEqual(PTY_INPUT_MAX_BYTES)
    }
  })

  it('中文（3 字节）与 emoji（4 字节、代理对）不被拆散', () => {
    const data = '中'.repeat(200_000) + '🎉'.repeat(10_000)
    const chunks = chunkTerminalInput(data)
    expect(chunks.join('')).toBe(data)
    for (const c of chunks) {
      expect(new TextEncoder().encode(c).length).toBeLessThanOrEqual(PTY_INPUT_MAX_BYTES)
      // 无孤立代理项（拆散代理对会产生）
      expect(/[\uD800-\uDBFF]$/.test(c)).toBe(false)
    }
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('自定义上限同样生效', () => {
    const chunks = chunkTerminalInput('abcdef', 2)
    expect(chunks).toEqual(['ab', 'cd', 'ef'])
  })
})
