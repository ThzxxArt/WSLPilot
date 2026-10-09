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
  type WslConfChange,
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
}

/** 文件不存在类错误（read 时降级为空配置） */
const NOT_FOUND_RE = /no such file|not found|cannot open|没有那个文件|找不到/i

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

  return {
    async read(name) {
      const distro = assertSafeDistroName(name)
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
    },

    async write(name, content) {
      const distro = assertSafeDistroName(name)
      const body = String(content ?? '')
      assertParsableWslConf(body)
      deps.logger.info('wsl.conf write', { distro, bytes: Buffer.byteLength(body, 'utf8') })
      const r = await runIn(['-d', distro, '-u', 'root', '-e', 'tee', WSL_CONF_PATH], body, {
        timeoutMs: 20_000,
      })
      if (r.code !== 0) {
        const text = `${r.stderr}\n${r.stdout}`
        const denied = /permission|denied|root|sudo|不允许|权限/i.test(text)
        throw createAppError(denied ? 'PERMISSION_DENIED' : 'IO_ERROR', {
          message: `写入 ${distro} 的 wsl.conf 失败`,
          detail: text.trim(),
          rawCommand: `wsl.exe -d ${distro} -u root -e tee ${WSL_CONF_PATH}`,
          suggestion: denied
            ? '需要发行版内 root 权限；请确认 wsl.exe 可以 -u root 执行'
            : '请查看原始输出并重试',
        })
      }
    },
  }
}

/** 变更清单 → 展示文案（差异预览标题栏摘要） */
export function summarizeWslConfChanges(changes: WslConfChange[]): string {
  if (changes.length === 0) return '无变更'
  const sets = changes.filter((c) => c.kind === 'set').length
  const removes = changes.filter((c) => c.kind === 'remove').length
  const parts: string[] = []
  if (sets > 0) parts.push(`${sets} 项修改`)
  if (removes > 0) parts.push(`${removes} 项删除`)
  return parts.join(' · ')
}
