/**
 * 提权客户端（ElevationHelper 客户端）— 设计书 §14.3。
 *
 * 主进程保持**非提权**；需要管理员权限的操作按需拉起独立辅助进程：
 *   Start-Process powershell -Verb RunAs -Wait  →  helper.ps1 读取结构化请求文件
 *
 * - 请求只含 op + 参数数组（`buildElevationHelperPayload` 唯一映射），不接受任意命令行
 * - 批量请求合并为**一次** UAC 提权会话（§14.3「合并提权会话减少 UAC 弹窗」）
 * - 用户取消 UAC → `canceled: true`（非错误，调用方给可执行的降级提示）
 */
import { promises as fs, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildElevationHelperPayload,
  createAppError,
  ELEVATION_OP_LABEL,
  validateElevationRequest,
  type ElevationOpResult,
  type ElevationRequest,
  type ElevationRunResult,
} from '@wslpilot/shared'
import { runTool, type Logger, type RunToolFn } from '@wslpilot/kit'
import { buildElevationHelperScript } from './helper-script'

/** UAC 弹窗可停留较久（用户可能切屏确认），给足超时 */
export const ELEVATION_TIMEOUT_MS = 5 * 60_000

/** UAC 取消识别（中英文 Windows） */
export function isUacCanceled(text: string): boolean {
  return /canceled by the user|was canceled|operation was canceled|已取消|被用户取消|用户取消/i.test(
    text,
  )
}

export interface ElevationClient {
  /** 执行一组结构化操作（单次 UAC）；返回逐操作结果 */
  run(requests: readonly ElevationRequest[]): Promise<ElevationRunResult>
  /** 单操作便捷入口 */
  runOne(request: ElevationRequest): Promise<ElevationOpResult>
}

export interface ElevationClientDeps {
  logger: Logger
  runTool?: RunToolFn
  /** 临时目录根（默认 os.tmpdir()） */
  tempRoot?: string
}

interface FsLike {
  writeFile: (path: string, content: string) => Promise<void>
  readFile: (path: string) => Promise<string>
  rm: (path: string) => Promise<void>
}

const defaultFs: FsLike = {
  writeFile: (path, content) => fs.writeFile(path, content, 'utf8'),
  readFile: (path) => fs.readFile(path, 'utf8'),
  rm: (path) => fs.rm(path, { force: true }).then(() => undefined),
}

/** 进程级唯一提权工作目录（每次 run 独立，杜绝请求/结果串台） */
function makeWorkspace(tempRoot: string): string {
  return mkdtempSync(join(tempRoot, 'wslpilot-elev-'))
}

export function createElevationClient(
  deps: ElevationClientDeps,
  fsLike: FsLike = defaultFs,
): ElevationClient {
  const logger = deps.logger
  const tool: RunToolFn = deps.runTool ?? runTool
  const tempRoot = deps.tempRoot ?? tmpdir()

  /**
   * PowerShell 单引号转义（外层启动命令的字符串定界）。
   * Start-Process -ArgumentList 会把元素按空格拼成命令行再交给子进程解析——
   * 元素值必须**自带双引号**，否则含空格路径（C:\Users\John Doe\…）被拦腰拆开。
   */
  const psQuote = (s: string) => `'${String(s).replace(/'/g, "''")}'`
  /** -ArgumentList 元素：值内嵌双引号（子进程命令行解析层的引号），再经 psQuote 传入 */
  const psArg = (s: string) => psQuote(`"${String(s).replace(/"/g, '\\"')}"`)

  async function run(requests: readonly ElevationRequest[]): Promise<ElevationRunResult> {
    // 先全部校验：任一非法请求都不进 UAC（白名单在提权前就拦住）
    for (const r of requests) validateElevationRequest(r)
    const payload = buildElevationHelperPayload(requests)
    const labels = requests.map((r) => ELEVATION_OP_LABEL[r.op] ?? r.op).join('、')
    logger.info('elevation requested', { ops: requests.map((r) => r.op), labels })

    const dir = makeWorkspace(tempRoot)
    const requestPath = join(dir, 'request.json')
    const resultPath = join(dir, 'result.json')
    const scriptPath = join(dir, 'helper.ps1')

    try {
      // UTF-8 BOM：Windows PowerShell 5.1 对无 BOM 的 .ps1 按系统 ANSI 码页解码，
      // 脚本内的非 ASCII 内容会静默变乱码（错误文案一旦中文化就会写坏执行逻辑）
      await fsLike.writeFile(scriptPath, `\ufeff${buildElevationHelperScript()}`)
      await fsLike.writeFile(requestPath, JSON.stringify(payload))
      await fsLike.writeFile(resultPath, '')

      // 外层启动器：拉起提权的 helper 进程并等待完成。
      // 两类引号语义不同（review 回验修复）：
      // - -FilePath 是参数值（不做命令行解析）：只用 PS 单引号定界，**不得**内嵌双引号
      //   （否则 FileName 变成字面 `"powershell.exe"`，Start-Process 找不到文件）
      // - -ArgumentList 元素会被拼成命令行再由子进程解析：值必须自带双引号（psArg），
      //   否则含空格路径（C:\Users\John Doe\…）被拦腰拆开
      const argList = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-RequestFile',
        requestPath,
        '-ResultFile',
        resultPath,
      ]
        .map(psArg)
        .join(',')
      const command = `try { Start-Process -FilePath ${psQuote('powershell.exe')} -ArgumentList @(${argList}) -Verb RunAs -Wait -ErrorAction Stop } catch { Write-Output $_.Exception.Message; exit 1 }`

      const r = await tool(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { timeoutMs: ELEVATION_TIMEOUT_MS },
      )
      const combined = `${r.stdout}\n${r.stderr}`
      let resultText = ''
      try {
        resultText = (await fsLike.readFile(resultPath)).trim()
      } catch {
        resultText = ''
      }

      if (!resultText) {
        if (isUacCanceled(combined)) {
          logger.info('elevation canceled by user', { ops: requests.map((x) => x.op) })
          return { canceled: true, results: [] }
        }
        logger.warn('elevation produced no result', {
          code: r.code,
          detail: combined.slice(0, 400),
        })
        return {
          canceled: false,
          error: combined.trim() || '提权助手未返回结果',
          results: [],
        }
      }

      const parsed = parseResultJson(resultText, requests)
      if (parsed.canceled) {
        logger.info('elevation canceled by user', { ops: requests.map((x) => x.op) })
      }
      return parsed
    } finally {
      // 提权残留物含命令参数，用完即焚（失败也不留垃圾 — 与 atomic-write 同一铁律）。
      // 清理失败不得顶掉 try 里的返回值（被杀软/提权子进程占用时 rmSync 会抛）
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch (e) {
        logger.warn('elevation cleanup failed', { dir, error: String(e) })
      }
    }
  }

  async function runOne(request: ElevationRequest): Promise<ElevationOpResult> {
    const res = await run([request])
    if (res.canceled) {
      throw createAppError('PERMISSION_DENIED', {
        message: `${ELEVATION_OP_LABEL[request.op] ?? request.op}：已取消管理员授权`,
        suggestion: '重新执行并在 UAC 弹窗中选择「是」，或在管理员终端中手动执行',
      })
    }
    const first = res.results[0]
    if (!first) {
      throw createAppError('PERMISSION_DENIED', {
        message: `${ELEVATION_OP_LABEL[request.op] ?? request.op}：提权执行失败`,
        detail: res.error,
      })
    }
    return first
  }

  return { run, runOne }
}

/** result.json → ElevationRunResult（形状容错，坏结果不吞错误） */
export function parseResultJson(
  text: string,
  requests: readonly ElevationRequest[],
): ElevationRunResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { canceled: false, error: '提权结果解析失败', results: [] }
  }
  const obj = (raw ?? {}) as Record<string, unknown>
  const canceled = obj.canceled === true
  const error = typeof obj.error === 'string' && obj.error ? obj.error : undefined
  const list = Array.isArray(obj.results) ? obj.results : []
  const results: ElevationOpResult[] = requests.map((req, i) => {
    const item = (list[i] ?? {}) as Record<string, unknown>
    return {
      op: req.op,
      ok: item.ok === true,
      code: typeof item.code === 'number' ? item.code : item.ok === true ? 0 : -1,
      stdout: typeof item.stdout === 'string' ? item.stdout : '',
      stderr: typeof item.stderr === 'string' ? item.stderr : '',
      error: typeof item.error === 'string' && item.error ? item.error : undefined,
    }
  })
  return { canceled, error, results }
}
