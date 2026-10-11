import { CH, createAppError, assertSafeDistroName, MAX_PTY_SESSIONS } from '@wslpilot/shared'
import * as os from 'node:os'
import type { PtyManager, PtyCreateOptions } from '../../services/pty-manager'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

function asCreate(arg: unknown): PtyCreateOptions {
  const o = (arg ?? {}) as Record<string, unknown>
  const num = (v: unknown, dflt: number, min: number, max: number) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return dflt
    return Math.max(min, Math.min(max, Math.floor(n)))
  }
  return {
    distro: assertSafeDistroName(o.distro),
    shell: typeof o.shell === 'string' ? o.shell : undefined,
    cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
    cols: num(o.cols, 80, 2, 500),
    rows: num(o.rows, 24, 1, 200),
  }
}

function asId(arg: unknown): string {
  const id = (arg ?? '') as string
  if (typeof id !== 'string' || !id.trim()) {
    throw createAppError('TASK_FAILED', { message: '缺少终端会话 id' })
  }
  return id
}

export function registerPtyHandlers(add: AddFn, deps: { pty: PtyManager }): void {
  const { pty } = deps

  add(CH.ptyCreate, async (c, arg: never) => {
    const o = asCreate(arg)
    // 硬门禁（review：开会话即 `wsl -d X -e`，会隐式启动发行版）：未运行不建会话
    await c.wsl?.assertRunning(o.distro)
    return pty.create(o)
  })

  add(CH.ptyInput, (_c, arg: never) => {
    const o = (arg ?? {}) as { ptyId?: string; data?: string }
    pty.input(asId(o.ptyId), String(o.data ?? ''))
  })

  add(CH.ptyResize, (_c, arg: never) => {
    const o = (arg ?? {}) as { ptyId?: string; cols?: number; rows?: number }
    pty.resize(asId(o.ptyId), Number(o.cols), Number(o.rows))
  })

  add(CH.ptyKill, (_c, arg: never) => {
    pty.kill(asId(arg))
  })

  add(CH.ptyList, () => {
    return pty.list()
  })

  // 供 UI 展示上限
  add(CH.ptyMaxSessions, () => MAX_PTY_SESSIONS)

  /**
   * 终端宿主信息（xterm `windowsPty` ConPTY 伪影对策用 — review 终端错位根治）。
   * buildNumber = Windows 构建号（os.release 形如 10.0.26200）；非 Windows 为 null。
   */
  add(CH.ptyHostInfo, () => {
    const rel = os.release()
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(rel)
    return {
      platform: process.platform,
      conptyBuild: process.platform === 'win32' && m ? Number(m[3]) : null,
    }
  })
}
