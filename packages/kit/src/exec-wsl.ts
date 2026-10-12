import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import type { ToolResult } from './run-tool'

const execFileAsync = promisify(execFile)

/** 执行结果的兼容导出名：与 run-tool 的 ToolResult 是同一类型（禁双名同构） */
export type WslExecResult = ToolResult

export interface WslExecOptions {
  timeoutMs?: number
  encoding?: 'utf16' | 'utf8' | 'auto'
}

/** wsl.exe 输出的两种形态（唯一事实源，判断逻辑见 detectWslEncoding） */
export type WslStreamEncoding = 'utf16le' | 'utf8'

/**
 * wsl.exe 输出编码探测（唯一事实源，一次性解码与流式解码共用）：
 * - wsl 内建命令（--list/--version 等）输出 UTF-16LE
 * - `-e <cmd>` 透传 Linux 程序 stdout 时是 UTF-8（现代 Windows 11 / WSL）
 * - 环境变量 WSL_UTF8=1 时内建命令也会改为 UTF-8
 * 识别策略：BOM（FF FE → UTF-16LE；EF BB BF → UTF-8）优先；
 * 否则看 UTF-16LE 文本的 ASCII 区段奇数位是否大量为 0x00；都不满足按 UTF-8。
 */
export function detectWslEncoding(sample: Buffer): WslStreamEncoding {
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) return 'utf16le'
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return 'utf8'
  }
  const end = sample.length - (sample.length % 2)
  let nulAtOdd = 0
  for (let i = 1; i < end; i += 2) if (sample[i] === 0x00) nulAtOdd++
  const utf16Like = end >= 4 && nulAtOdd >= Math.floor(end / 2) * 0.3
  return utf16Like ? 'utf16le' : 'utf8'
}

/**
 * 整段解码（execFile 路径）。固定 utf16le 解码会把 UTF-8 字节两两并成汉字乱码
 * （"MEM:" → 䕍㩍…），下游解析全灭 —— 必须先探测再解。
 */
export function decodeWslOutput(b?: Buffer | string | null): string {
  if (!b) return ''
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b as string)
  if (buf.length === 0) return ''
  const sample = buf.subarray(0, Math.min(buf.length, 128))
  const enc = detectWslEncoding(sample)
  if (enc === 'utf16le') {
    const hasBom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
    const body = hasBom ? buf.subarray(2) : buf
    return body.toString('utf16le').replace(/\0/g, '')
  }
  return buf.toString('utf8')
}

/**
 * 流式行解码器（spawn 路径唯一实现）：
 * - 首块缓冲到达探测阈值（BOM 完整或 ≥4 字节）后锁定编码，此后不再改判
 * - 用 StringDecoder 处理跨块的残缺字节（UTF-8 多字节序列 / UTF-16 半单元）
 * - 逐行 emit；flush 时输出最后一行残段（不丢尾数据）
 *
 * 修复的真相：此前 spawnWsl 固定 utf16le 解码，而 headless 自定义动作
 * （`wsl -d X -e program`）与 WSL_UTF8=1 环境的输出是 UTF-8 —— 日志两两并成
 * 汉字乱码、换行被吞，用户看到的是不可读的任务日志。
 */
export function createLineStreamDecoder(onLine: (line: string) => void): {
  push(chunk: Buffer): void
  flush(): void
} {
  let decoder: StringDecoder | null = null
  let pending = Buffer.alloc(0)
  let lineBuf = ''

  const emitText = (text: string): void => {
    if (!text) return
    lineBuf += text
    const lines = lineBuf.split(/\r?\n/)
    lineBuf = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  }

  /** 剥离 BOM（与探测结果对应的形态） */
  const stripBom = (buf: Buffer, enc: WslStreamEncoding): Buffer => {
    if (enc === 'utf16le' && buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      return buf.subarray(2)
    }
    if (
      enc === 'utf8' &&
      buf.length >= 3 &&
      buf[0] === 0xef &&
      buf[1] === 0xbb &&
      buf[2] === 0xbf
    ) {
      return buf.subarray(3)
    }
    return buf
  }

  const lockIn = (enc: WslStreamEncoding): void => {
    decoder = new StringDecoder(enc)
    const rest = stripBom(pending, enc)
    pending = Buffer.alloc(0)
    emitText(decoder.write(rest))
  }

  return {
    push(chunk: Buffer) {
      if (decoder) {
        emitText(decoder.write(chunk))
        return
      }
      pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk])
      // 探测阈值：BOM 完整即可判定；否则需 ≥4 字节（与 detectWslEncoding 的判据一致）
      const bom16 = pending.length >= 2 && pending[0] === 0xff && pending[1] === 0xfe
      const bom8 =
        pending.length >= 3 && pending[0] === 0xef && pending[1] === 0xbb && pending[2] === 0xbf
      if (!bom16 && !bom8 && pending.length < 4) return
      lockIn(detectWslEncoding(pending.subarray(0, Math.min(pending.length, 128))))
    },
    flush() {
      if (decoder) {
        emitText(decoder.end())
      } else if (pending.length > 0) {
        // 流结束仍未达探测阈值：兜底解出剩余数据（绝不静默丢尾）
        lockIn(detectWslEncoding(pending))
        if (decoder) emitText((decoder as StringDecoder).end())
      }
      if (lineBuf.trim() !== '') onLine(lineBuf)
      lineBuf = ''
    },
  }
}

/**
 * 执行 wsl.exe。
 * 输出编码按 decodeWslOutput 自适应（UTF-16LE / UTF-8），一律参数数组传入，禁止字符串拼接。
 */
export async function runWsl(args: string[], opts: WslExecOptions = {}): Promise<WslExecResult> {
  const decode = (b?: Buffer | string | null): string => {
    if (!b) return ''
    if (opts.encoding === 'utf8') return Buffer.isBuffer(b) ? b.toString('utf8') : String(b)
    if (opts.encoding === 'utf16') {
      const buf = Buffer.isBuffer(b) ? b : Buffer.from(b as string)
      return buf.toString('utf16le').replace(/\0/g, '')
    }
    return decodeWslOutput(b)
  }

  try {
    const { stdout, stderr } = await execFileAsync('wsl.exe', args, {
      encoding: 'buffer',
      windowsHide: true,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    return {
      stdout: decode(stdout as unknown as Buffer),
      stderr: decode(stderr as unknown as Buffer),
      code: 0,
    }
  } catch (e) {
    const err = e as { code?: number | string; message?: string; stdout?: Buffer; stderr?: Buffer }
    // spawn 级错误（ENOENT 等）没有 stderr，必须保留 message，否则上层错误映射失效（review M6）
    const stderrText = decode(err.stderr) || (err.message ? `${err.message}\n` : '')
    return {
      stdout: decode(err.stdout),
      stderr: stderrText,
      code: typeof err.code === 'number' ? err.code : -1,
    }
  }
}

/**
 * 执行 wsl.exe 并向 stdin 写入内容（UTF-8，Linux 侧语义）。
 * 用于 `wsl -d <name> -u root -e tee /etc/wsl.conf` 这类「内容走 stdin、不经 shell 拼接」的写入（M5）。
 * 约束：input ≤ 4MB；输出按 decodeWslOutput 自适应解码（UTF-16LE / UTF-8 双形态）。
 */
export async function runWslWithStdin(
  args: string[],
  input: string,
  opts: WslExecOptions = {},
): Promise<WslExecResult> {
  const MAX_INPUT = 4 * 1024 * 1024
  const body = String(input ?? '')
  if (Buffer.byteLength(body, 'utf8') > MAX_INPUT) {
    return { stdout: '', stderr: 'stdin 超过 4MB 上限\n', code: -1 }
  }
  const decode = (b?: Buffer | string | null): string => {
    if (!b) return ''
    if (opts.encoding === 'utf8') return Buffer.isBuffer(b) ? b.toString('utf8') : String(b)
    if (opts.encoding === 'utf16') {
      const buf = Buffer.isBuffer(b) ? b : Buffer.from(b as string)
      return buf.toString('utf16le').replace(/\0/g, '')
    }
    return decodeWslOutput(b)
  }

  return new Promise<WslExecResult>((resolve) => {
    const child = spawn('wsl.exe', args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const errBuf: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ stdout: '', stderr: '命令超时\n', code: -1 })
    }, opts.timeoutMs ?? 30_000)
    ;(timer as unknown as { unref?: () => void }).unref?.()

    child.stdout?.on('data', (c: Buffer) => out.push(c))
    child.stderr?.on('data', (c: Buffer) => errBuf.push(c))
    child.on('error', (e: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout: '', stderr: `${e.message}\n`, code: -1 })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        stdout: decode(Buffer.concat(out)),
        stderr: decode(Buffer.concat(errBuf)),
        code: code ?? -1,
      })
    })

    const stdin = child.stdin
    if (!stdin) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ stdout: '', stderr: 'stdin 不可用\n', code: -1 })
      }
      return
    }
    stdin.on('error', () => {
      /* EPIPE：进程提前退出，由 close 收尾 */
    })
    stdin.end(Buffer.from(body, 'utf8'))
  })
}

export interface ParsedDistro {
  isDefault: boolean
  name: string
  state: string
  version: number
}

/**
 * 解析 `wsl --list --verbose` 输出。
 * 按多空白切分（兼容中文列宽），不用固定列位。
 * 默认标记是「行首第 1 列」的 `*`（名字本身可含 `*`，不得吃掉名字首字符 — review M4）。
 */
export function parseDistroList(raw: string): ParsedDistro[] {
  return raw
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const isDefault = line.startsWith('*')
      const body = (isDefault ? line.slice(1) : line).trim()
      const parts = body.split(/\s{2,}/)
      const versionNum = Number(parts[2] ?? 2)
      return {
        isDefault,
        name: parts[0] ?? '',
        state: parts[1] ?? 'Unknown',
        // 非法/缺失版本号一律归一为 2，杜绝 NaN 流入领域模型
        version: versionNum === 1 ? 1 : 2,
      }
    })
    .filter((d) => d.name !== '')
}

/**
 * 生成等价命令行（仅用于界面展示，绝不用于执行）。
 * 纯转发壳：实现唯一收敛在 shared 的 formatCommand，本名仅作兼容导出（新代码直接用 formatCommand）。
 */
export { formatCommand as getRawCommand } from '@wslpilot/shared'

export interface SpawnWslOptions {
  onLine: (line: string) => void
  onExit: (code: number) => void
  onError: (err: Error) => void
}

/** 长任务：spawn 流式读取，支持进度解析与取消 */
export function spawnWsl(args: string[], opts: SpawnWslOptions): { kill: () => void } {
  const child = spawn('wsl.exe', args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // stdout / stderr 各自使用独立的流式解码器：编码按流首块探测并锁定
  // （内建命令 UTF-16LE、`-e` 透传 UTF-8、WSL_UTF8=1 全局 UTF-8），
  // 跨块残缺字节由 StringDecoder 内部处理，行拆分见 createLineStreamDecoder。
  const onStdout = createLineStreamDecoder(opts.onLine)
  const onStderr = createLineStreamDecoder(opts.onLine)

  child.stdout?.on('data', (c: Buffer) => onStdout.push(c))
  child.stderr?.on('data', (c: Buffer) => onStderr.push(c))
  child.on('error', opts.onError)
  child.on('close', (code) => {
    onStdout.flush()
    onStderr.flush()
    opts.onExit(code ?? -1)
  })

  return {
    kill: () => {
      child.kill()
    },
  }
}
