import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createAppError, MAX_PTY_SESSIONS, assertSafeDistroName } from '@wslpilot/shared'
import type { Logger } from '@wslpilot/kit'

const req = createRequire(__filename)

// eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
const SHELL_CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export interface PtyCreateOptions {
  distro: string
  shell?: string
  cwd?: string
  cols: number
  rows: number
}

export interface PtySessionInfo {
  ptyId: string
  distro: string
  shell: string
  cwd?: string
  createdAt: number
}

/** 最小 IPty 形状 — 便于注入 mock */
export interface PtyProcessLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
  pid: number
}

export type PtySpawnFn = (
  file: string,
  args: string[],
  options: {
    name: string
    cols: number
    rows: number
    cwd: string
    env: Record<string, string | undefined>
    useConpty: boolean
  },
) => PtyProcessLike

export interface PtyEvents {
  onData: (ptyId: string, chunk: string) => void
  onExit: (ptyId: string, code: number) => void
}

export interface PtyManagerOptions {
  /** 默认 shell（settings.wsl.defaultShell）；空则回退 /bin/bash */
  defaultShell?: string | (() => string)
}

export interface PtyManager {
  create(opts: PtyCreateOptions): PtySessionInfo
  input(ptyId: string, data: string): void
  resize(ptyId: string, cols: number, rows: number): void
  kill(ptyId: string): void
  killAll(): void
  list(): PtySessionInfo[]
  get(ptyId: string): PtySessionInfo | null
  count(): number
}

function getOrThrow(
  sessions: Map<string, { proc: PtyProcessLike; info: PtySessionInfo }>,
  id: string,
) {
  const s = sessions.get(id)
  if (!s) {
    throw createAppError('TASK_FAILED', { message: `终端会话不存在或已关闭：${id}` })
  }
  return s
}

/**
 * 终端会话池（设计书 §9.4）
 * - 会话上限 MAX_PTY_SESSIONS（10）
 * - wsl.exe -d <distro> [--cd cwd] -e <shell>（-e 分界，参数数组）
 * - ConPTY 后端
 * - 退出统一 kill
 */
export function createPtyManager(
  logger: Logger,
  events: PtyEvents,
  spawnFn?: PtySpawnFn,
  options?: PtyManagerOptions,
): PtyManager {
  const sessions = new Map<string, { proc: PtyProcessLike; info: PtySessionInfo }>()

  // 默认 spawn：createRequire 加载 node-pty（asarUnpack 后路径稳定）
  const spawn: PtySpawnFn =
    spawnFn ??
    ((file, args, spawnOptions) => {
      const pty = req('node-pty') as typeof import('node-pty')
      return pty.spawn(file, args, spawnOptions as never) as unknown as PtyProcessLike
    })

  function defaultShell(): string {
    // 尊重 settings.wsl.defaultShell（设计书 §6.3 — review M21）
    const configured =
      typeof options?.defaultShell === 'function' ? options.defaultShell() : options?.defaultShell
    const s = configured?.trim()
    return s || '/bin/bash'
  }

  return {
    create(opts) {
      if (sessions.size >= MAX_PTY_SESSIONS) {
        throw createAppError('TASK_FAILED', {
          message: `终端会话数已达上限 ${MAX_PTY_SESSIONS}，请先关闭部分终端`,
        })
      }
      const distro = assertSafeDistroName(opts.distro)
      const shell = opts.shell?.trim() || defaultShell()
      // shell 走 -e 分界，仅作为程序路径；拒绝逃逸/控制字符/伪参数（review M22）
      if (
        !shell ||
        shell.includes('..') ||
        shell.startsWith('-') ||
        SHELL_CONTROL_CHARS.test(shell)
      ) {
        throw createAppError('TASK_FAILED', { message: `非法的 shell：${shell}` })
      }

      const args = ['-d', distro]
      if (opts.cwd && opts.cwd.trim()) {
        // --cd 路径不进 shell；用数组传参
        args.push('--cd', opts.cwd.trim())
      }
      args.push('-e', shell)

      const cols = Math.max(2, Math.min(500, Math.floor(opts.cols) || 80))
      const rows = Math.max(1, Math.min(200, Math.floor(opts.rows) || 24))

      const proc = spawn('wsl.exe', args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.USERPROFILE ?? process.env.HOME ?? '.',
        env: process.env,
        useConpty: true,
      })

      const id = randomUUID()
      const info: PtySessionInfo = {
        ptyId: id,
        distro,
        shell,
        cwd: opts.cwd,
        createdAt: Date.now(),
      }
      sessions.set(id, { proc, info })

      proc.onData((chunk) => {
        events.onData(id, chunk)
      })
      proc.onExit(({ exitCode }) => {
        sessions.delete(id)
        try {
          proc.kill()
        } catch {
          /* 已退出 */
        }
        events.onExit(id, exitCode ?? 0)
      })

      logger.info('pty created', { ptyId: id, distro, shell, pid: proc.pid })
      return info
    },

    input(ptyId, data) {
      const s = getOrThrow(sessions, ptyId)
      if (typeof data !== 'string' || data.length === 0) return
      s.proc.write(data)
    },

    resize(ptyId, cols, rows) {
      const s = getOrThrow(sessions, ptyId)
      const cn = Number(cols)
      const rn = Number(rows)
      const c = Math.max(2, Math.min(500, Number.isFinite(cn) ? Math.floor(cn) : 80))
      const r = Math.max(1, Math.min(200, Number.isFinite(rn) ? Math.floor(rn) : 24))
      s.proc.resize(c, r)
    },

    kill(ptyId) {
      const s = sessions.get(ptyId)
      if (!s) return
      sessions.delete(ptyId)
      try {
        s.proc.kill()
      } catch (e) {
        logger.warn('pty kill failed', { ptyId, error: String(e) })
      }
    },

    killAll() {
      for (const [id, s] of sessions) {
        try {
          s.proc.kill()
        } catch {
          /* ignore */
        }
        sessions.delete(id)
      }
    },

    list() {
      return [...sessions.values()].map((s) => s.info)
    },

    get(ptyId) {
      return sessions.get(ptyId)?.info ?? null
    },

    count() {
      return sessions.size
    },
  }
}
