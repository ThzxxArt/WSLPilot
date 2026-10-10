/**
 * 终端输入分片（M7 数据安全）。
 * IPC `pty:data` 入参上限 256KB（ipc-schema ptyInput）——超过必须由渲染层分片，
 * 否则大段粘贴被 zod 拒绝后**静默丢失**。切分按 UTF-8 字节数且不拆散代理对。
 */
import { utf8Bytes } from '@shared/ipc-schema'

export const PTY_INPUT_MAX_BYTES = 1024 * 256

/** 单个 Unicode 码点的 UTF-8 字节数 */
function codePointBytes(cp: number): number {
  if (cp <= 0x7f) return 1
  if (cp <= 0x7ff) return 2
  if (cp <= 0xffff) return 3
  return 4
}

/**
 * 把一段终端输入切成若干 ≤ maxBytes（UTF-8）的片段。
 * for...of 按码点遍历（代理对天然完整）；单片段超限的极端情形不会出现（码点 ≤ 4 字节）。
 */
export function chunkTerminalInput(data: string, maxBytes = PTY_INPUT_MAX_BYTES): string[] {
  if (utf8Bytes(data) <= maxBytes) return [data]
  const out: string[] = []
  let current = ''
  let currentBytes = 0
  for (const ch of data) {
    const b = codePointBytes(ch.codePointAt(0) ?? 0)
    if (currentBytes + b > maxBytes && current !== '') {
      out.push(current)
      current = ''
      currentBytes = 0
    }
    current += ch
    currentBytes += b
  }
  if (current !== '') out.push(current)
  return out
}
