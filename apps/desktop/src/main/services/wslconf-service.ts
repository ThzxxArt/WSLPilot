/**
 * /etc/wsl.conf 读写服务（M5 配置与动作）。
 * - 读：`wsl.exe -d <name> -e cat /etc/wsl.conf`（默认用户可读；文件不存在返回空串）
 * - 写：`wsl.exe -d <name> -u root -e tee /etc/wsl.conf` + stdin（内容不进 shell，杜绝拼接注入）
 * 「提权」= 发行版内 root（Linux 侧），不是 Windows UAC（ElevationHelper 属 M7）。
 */
import {
  createAppError,
  assertSafeDistroName,
  parseIniLines,
  WSL_CONF_MAX_BYTES,
  type WslConfWriteResult,
} from '@wslpilot/shared'
import { runWsl, runWslWithStdin, type Logger } from '@wslpilot/kit'

export const WSL_CONF_PATH = '/etc/wsl.conf'
/** 字节上限唯一事实源在 @wslpilot/shared（ipc-schema 与执行边界共用） */
export { WSL_CONF_MAX_BYTES }

export interface WslConfService {
  /** 读取原文；文件不存在返回 ''（视为默认配置） */
  read(name: string): Promise<string>
  /** 写入原文（root tee）；内容必须可按 INI 解析 */
  write(name: string, content: string): Promise<void>
  /**
   * 写入（root tee）后按需 `wsl --terminate`，两步在同一 per-distro 队列内执行。
   * review 0.1.2 审计修复：terminate 此前在写队列之外，并发保存会落在
   * 另一次写的 terminate 窗口内；同队列保证 写1→terminate1→写2 严格有序。
   * terminate 失败不回滚已完成的写入（返回 terminateError 供 UI 提示手动重启）。
   */
  writeAndMaybeTerminate(
    name: string,
    content: string,
    terminate: boolean,
  ): Promise<WslConfWriteResult>
}

export type RunWslFn = (
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<{
  stdout: string
  stderr: string
  code: number
}>
export type RunWslStdinFn = (
  args: string[],
  input: string,
  opts?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>

export interface WslConfServiceDeps {
  logger: Logger
  runWsl?: RunWslFn
  runWslWithStdin?: RunWslStdinFn
  /** 发行版终止（8 秒规则）；由装配处注入 wsl.terminate，纳入写队列内调用 */
  terminate?: (name: string) => Promise<void>
}

/**
 * 文件不存在类错误（read 时降级为空配置）。
 * review 0.1.2 根治：原正则裸 `not found` 会把「发行版不存在」等执行错误误判为
 * 「文件不存在 → 空配置」，错误被吞成默认值。现要求命中 cat/tee 行语境或
 * 显式文件语境短语；发行版级报错（如 no distribution…）不再命中。
 */
const NOT_FOUND_RE = new RegExp(
  [
    // `cat: /etc/wsl.conf: No such file or directory` / 中文同义（工具行前缀锚定）
    String.raw`(?:cat|tee)\s*:[^\r\n]*(?:no such file|not found|没有那个文件|找不到)`,
    // 裸系统文案本身已含 file/directory 语境，允许直配
    String.raw`no such file or directory`,
    String.raw`没有那个文件或目录`,
    // `Cannot open ... for reading` 需带 file/文件 语境，避免误吞发行版级错误
    String.raw`cannot open[^\r\n]*(?:file|文件)`,
    String.raw`文件不存在`,
  ].join('|'),
  'i',
)

/** 权限失败识别：review 0.1.2 根治裸 `root` —— 路径/文案里出现 root 不代表权限不足 */
const PERMISSION_RE = /permission|denied|sudo|不允许|权限/i

/**
 * 写入前的语法守卫：只允许 blank/comment/section/entry 行。
 * 「无法识别的行」意味着用户的意图可能被 tee 原样写坏，直接拒绝并给出行号。
 */
export function assertParsableWslConf(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > WSL_CONF_MAX_BYTES) {
    throw createAppError('CONFIG_INVALID', {
      message: `wsl.conf 超过 ${WSL_CONF_MAX_BYTES / 1024}KB 上限`,
    })
  }
  const lines = parseIniLines(content)
  const bad = lines.findIndex((l) => l.type === 'other')
  if (bad >= 0) {
    throw createAppError('CONFIG_INVALID', {
      message: `wsl.conf 第 ${bad + 1} 行无法识别，已拒绝写入`,
      detail: lines[bad]!.raw,
      suggestion: '每行应为 [section]、key = value 或以 # / ; 开头的注释',
    })
  }
}

export function createWslConfService(deps: WslConfServiceDeps): WslConfService {
  const run = deps.runWsl ?? runWsl
  const runIn = deps.runWslWithStdin ?? runWslWithStdin

  /**
   * 同发行版读-写轻量串行（review 0.1.2 根治）：
   * 渲染层「读→编辑→写」与并发只读若交错，后发读可能拿到旧内容做整体覆盖。
   * 按发行版名排队，不阻塞其它发行版。
   */
  const tails = new Map<string, Promise<unknown>>()
  function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve()
    const p = prev.then(fn, fn)
    const tail = p.catch(() => {})
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return p
  }

  /** 队列内的实际写入体（root tee + stdin）；校验在入队前完成 */
  async function writeBody(distro: string, body: string): Promise<void> {
    deps.logger.info('wsl.conf write', { distro, bytes: Buffer.byteLength(body, 'utf8') })
    const r = await runIn(['-d', distro, '-u', 'root', '-e', 'tee', WSL_CONF_PATH], body, {
      timeoutMs: 20_000,
    })
    if (r.code !== 0) {
      const text = `${r.stderr}\n${r.stdout}`
      const denied = PERMISSION_RE.test(text)
      throw createAppError(denied ? 'PERMISSION_DENIED' : 'IO_ERROR', {
        message: `写入 ${distro} 的 wsl.conf 失败`,
        detail: text.trim(),
        rawCommand: `wsl.exe -d ${distro} -u root -e tee ${WSL_CONF_PATH}`,
        suggestion: denied
          ? '需要发行版内 root 权限；请确认 wsl.exe 可以 -u root 执行'
          : '请查看原始输出并重试',
      })
    }
  }

  function parseWriteArgs(name: string, content: string): { distro: string; body: string } {
    const distro = assertSafeDistroName(name)
    const body = String(content ?? '')
    assertParsableWslConf(body)
    return { distro, body }
  }

  return {
    async read(name) {
      const distro = assertSafeDistroName(name)
      return enqueue(distro.toLowerCase(), async () => {
        const r = await run(['-d', distro, '-e', 'cat', WSL_CONF_PATH], { timeoutMs: 15_000 })
        if (r.code === 0) return r.stdout
        const text = `${r.stderr}\n${r.stdout}`
        if (NOT_FOUND_RE.test(text)) {
          deps.logger.debug('wsl.conf not found, treating as default', { distro })
          return ''
        }
        throw createAppError('IO_ERROR', {
          message: `读取 ${distro} 的 wsl.conf 失败`,
          detail: text.trim(),
          rawCommand: `wsl.exe -d ${distro} -e cat ${WSL_CONF_PATH}`,
          suggestion: '请确认发行版可正常启动，且当前用户可读 /etc/wsl.conf',
        })
      })
    },

    async write(name, content) {
      const { distro, body } = parseWriteArgs(name, content)
      return enqueue(distro.toLowerCase(), () => writeBody(distro, body))
    },

    async writeAndMaybeTerminate(name, content, terminate) {
      const { distro, body } = parseWriteArgs(name, content)
      return enqueue(distro.toLowerCase(), async () => {
        await writeBody(distro, body)
        if (!terminate) return { terminated: false }
        const stop = deps.terminate
        if (!stop) {
          // 装配缺失不得静默假装已终止（消灭静默旁路）
          deps.logger.warn('wslconf terminate requested but not wired', { distro })
          return { terminated: false, terminateError: 'terminate 未装配，配置将在下次启动时生效' }
        }
        try {
          await stop(distro)
          return { terminated: true }
        } catch (e) {
          // 文件已写成功 —— terminate 失败只影响「8 秒规则是否立即生效」，
          // 不得把整次写入当作失败（返回可读原因，由 UI 提示手动重启）
          const msg = e instanceof Error ? e.message : String(e)
          deps.logger.warn('wslconf written but terminate failed', { distro, error: msg })
          return { terminated: false, terminateError: msg }
        }
      })
    },
  }
}
