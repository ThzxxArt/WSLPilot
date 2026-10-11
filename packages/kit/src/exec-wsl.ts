import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolResult } from './run-tool'

const execFileAsync = promisify(execFile)

/** 执行结果的兼容导出名：与 run-tool 的 ToolResult 是同一类型（禁双名同构） */
export type WslExecResult = ToolResult

export interface WslExecOptions {
  timeoutMs?: number
  encoding?: 'utf16' | 'utf8' | 'auto'
}

/**
 * wsl.exe 输出编码自适应（review 指标全零根治）：
 * - wsl 内建命令（--list/--version 等）输出 UTF-16LE
 * - `-e <cmd>` 透传 Linux 程序 stdout 时是 UTF-8（现代 Windows 11 / WSL）
 * 固定按 utf16le 解码会把 UTF-8 字节两两并成汉字乱码（"MEM:" → 䕍㩍…），下游解析全灭。
 * 识别策略：UTF-16LE 文本的 ASCII 区段奇数位必为 0x00（或带 BOM FF FE）；否则按 UTF-8。
 */
export function decodeWslOutput(b?: Buffer | string | null): string {
  if (!b) return ''
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b as string)
  if (buf.length === 0) return ''
  const hasBom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
  const sample = buf.subarray(0, Math.min(buf.length, 128))
  let nulAtOdd = 0
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0x00) nulAtOdd++
  const utf16Like =
    hasBom || (sample.length >= 4 && nulAtOdd >= Math.floor(sample.length / 2) * 0.3)
  if (utf16Like) {
    const body = hasBom ? buf.subarray(2) : buf
    return body.toString('utf16le').replace(/\0/g, '')
  }
  return buf.toString('utf8')
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
 * 约束：input ≤ 4MB；输出仍按 UTF-16LE 解码。
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

  // stdout / stderr 各自缓冲，避免交错时把半行拼接；
  // UTF-16LE 按 2 字节对解码，残缺字节留到下一块，防长输出劈字。
  const makeHandler = () => {
    let pending = Buffer.alloc(0)
    let lineBuf = ''
    let first = true
    return {
      push(chunk: Buffer) {
        pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk])
        const usable = pending.length - (pending.length % 2)
        if (usable <= 0) return
        let text = pending.subarray(0, usable).toString('utf16le').replace(/\0/g, '')
        pending = pending.subarray(usable)
        if (first) {
          first = false
          text = text.replace(/^\uFEFF/, '')
        }
        lineBuf += text
        const lines = lineBuf.split(/\r?\n/)
        lineBuf = lines.pop() ?? ''
        for (const line of lines) opts.onLine(line)
      },
      flush() {
        if (pending.length > 0) {
          // 残缺 1 字节无法构成 UTF-16 单元，丢弃（review m8）
          pending = Buffer.alloc(0)
        }
        if (lineBuf.trim() !== '') opts.onLine(lineBuf)
        lineBuf = ''
      },
    }
  }

  const onStdout = makeHandler()
  const onStderr = makeHandler()

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
