/**
 * Windows 控制台工具执行（M6 网络/设备）：netsh / usbipd 等。
 * 与 runWsl 的差别：输出编码不是 UTF-16LE，按代码页探测解码（见 tool-output）。
 * 一律参数数组传入，禁止字符串拼接。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { decodeToolOutput } from './tool-output'

const execFileAsync = promisify(execFile)

export interface ToolResult {
  stdout: string
  stderr: string
  code: number
}

export interface RunToolOptions {
  timeoutMs?: number
}

export type RunToolFn = (
  program: string,
  args: string[],
  opts?: RunToolOptions,
) => Promise<ToolResult>

/**
 * 执行 Windows 控制台工具。失败不抛异常，返回 code/stderr（与 runWsl 同一约定），
 * 由调用方决定错误映射（如提权失败 → PERMISSION_DENIED）。
 */
export async function runTool(
  program: string,
  args: string[],
  opts: RunToolOptions = {},
): Promise<ToolResult> {
  try {
    const { stdout, stderr } = await execFileAsync(program, args, {
      encoding: 'buffer',
      windowsHide: true,
      timeout: opts.timeoutMs ?? 20_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    return {
      stdout: decodeToolOutput(stdout as unknown as Buffer),
      stderr: decodeToolOutput(stderr as unknown as Buffer),
      code: 0,
    }
  } catch (e) {
    const err = e as {
      code?: number | string
      message?: string
      stdout?: Buffer
      stderr?: Buffer
    }
    // spawn 级错误（ENOENT 等）没有 stderr，必须保留 message（与 runWsl 一致）
    const stderrText = decodeToolOutput(err.stderr) || (err.message ? `${err.message}\n` : '')
    return {
      stdout: decodeToolOutput(err.stdout),
      stderr: stderrText,
      code: typeof err.code === 'number' ? err.code : -1,
    }
  }
}
