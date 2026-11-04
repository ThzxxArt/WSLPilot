/**
 * 通用控制台工具流式执行（0.2.0）：wslc.exe 的 logs/events/pull/build 等。
 *
 * 与 `spawnWsl` 的差异：
 * - 输出按 UTF-8 流式解码（wslc 输出 JSON/文本，不是 wsl.exe 内建命令的 UTF-16LE）
 * - 支持 AbortSignal、超时、无输出看门狗（由调用方决定时限）
 * - 只返回 kill 句柄；退出/错误/行通过回调上报
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

export interface SpawnToolOptions {
  onLine: (line: string) => void
  onExit: (code: number) => void
  onError: (err: Error) => void
  signal?: AbortSignal
  /** 环境变量（默认继承 process.env） */
  env?: NodeJS.ProcessEnv
  /** 工作目录 */
  cwd?: string
}

export interface SpawnToolHandle {
  kill(): void
  readonly pid: number | undefined
}

/** 按行切分 UTF-8 流；flush 时输出最后残行（不丢尾） */
export function createUtf8LineDecoder(onLine: (line: string) => void): {
  push(chunk: Buffer): void
  flush(): void
} {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  const emit = (text: string) => {
    if (!text) return
    pending += text
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  }
  return {
    push(chunk) {
      emit(decoder.write(chunk))
    },
    flush() {
      emit(decoder.end())
      if (pending !== '') {
        onLine(pending)
        pending = ''
      }
    },
  }
}

export function spawnTool(
  program: string,
  args: string[],
  opts: SpawnToolOptions,
): SpawnToolHandle {
  let child: ChildProcess
  try {
    child = spawn(program, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      signal: opts.signal,
    })
  } catch (e) {
    opts.onError(e instanceof Error ? e : new Error(String(e)))
    return { kill: () => {}, pid: undefined }
  }

  const out = createUtf8LineDecoder(opts.onLine)
  const err = createUtf8LineDecoder(opts.onLine)
  child.stdout?.on('data', (c: Buffer) => out.push(c))
  child.stderr?.on('data', (c: Buffer) => err.push(c))
  child.on('error', (e: Error) => opts.onError(e))
  child.on('close', (code) => {
    out.flush()
    err.flush()
    opts.onExit(code ?? -1)
  })

  return {
    kill: () => {
      try {
        child.kill()
      } catch {
        /* 已退出 */
      }
    },
    pid: child.pid,
  }
}
