import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { formatCommand } from '@wslpilot/shared'

const execFileAsync = promisify(execFile)

export interface WslExecResult {
  stdout: string
  stderr: string
  code: number
}

export interface WslExecOptions {
  timeoutMs?: number
  encoding?: 'utf16' | 'utf8'
}

/**
 * 执行 wsl.exe。
 * 关键：Windows 上 wsl.exe 标准输出为 UTF-16LE，必须 Buffer + utf16le 解码并清 \0。
 * 一律参数数组传入，禁止字符串拼接。
 */
export async function runWsl(args: string[], opts: WslExecOptions = {}): Promise<WslExecResult> {
  const decode = (b?: Buffer | string | null): string => {
    if (!b) return ''
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b as string)
    if (opts.encoding === 'utf8') return buf.toString('utf8')
    return buf.toString('utf16le').replace(/\0/g, '')
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
    const err = e as { code?: number; stdout?: Buffer; stderr?: Buffer }
    return {
      stdout: decode(err.stdout),
      stderr: decode(err.stderr),
      code: typeof err.code === 'number' ? err.code : -1,
    }
  }
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
 */
export function parseDistroList(raw: string): ParsedDistro[] {
  return raw
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const trimmed = line.trimStart()
      const isDefault = trimmed.startsWith('*')
      // 仅去掉「默认标记」的一个 *，保留名称内部的 *
      const body = (isDefault ? trimmed.slice(1) : line).trim()
      const parts = body.split(/\s{2,}/)
      return {
        isDefault,
        name: parts[0] ?? '',
        state: parts[1] ?? 'Unknown',
        version: Number(parts[2] ?? 2),
      }
    })
    .filter((d) => d.name !== '')
}

/** 生成等价命令行（仅用于界面展示，绝不用于执行） */
export function getRawCommand(program: string, args: string[]): string {
  return formatCommand(program, args)
}

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
    return {
      push(chunk: Buffer) {
        pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk])
        const usable = pending.length - (pending.length % 2)
        if (usable <= 0) return
        const text = pending.subarray(0, usable).toString('utf16le').replace(/\0/g, '')
        pending = pending.subarray(usable)
        lineBuf += text
        const lines = lineBuf.split(/\r?\n/)
        lineBuf = lines.pop() ?? ''
        for (const line of lines) opts.onLine(line)
      },
      flush() {
        if (pending.length > 0) {
          lineBuf += pending.toString('utf16le').replace(/\0/g, '')
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
