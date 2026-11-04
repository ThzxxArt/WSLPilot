import { CH, createAppError, assertSafeDistroName, MAX_PTY_SESSIONS } from '@wslpilot/shared'
import * as os from 'node:os'
import type { PtyManager, PtyCreateOptions } from '../../services/pty-manager'
import type { ShellIntegrationService } from '../../services/shell-integration-service'
import type { WslService } from '../../services/wsl-service'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  // 参数经 parseIpcArgs 校验后按通道约定类型传入
  handler: (ctx: IpcContext, arg: never) => unknown,
) => void

/** 设置中的默认 Shell；读配置失败回退 /bin/bash（终端必须可用） */
function defaultShell(ctx: IpcContext): string {
  try {
    return ctx.configService.loadSync('settings').wsl.defaultShell?.trim() || '/bin/bash'
  } catch {
    return '/bin/bash'
  }
}

function asCreate(arg: unknown): PtyCreateOptions {
  const o = (arg ?? {}) as Record<string, unknown>
  const num = (v: unknown, dflt: number, min: number, max: number) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return dflt
    return Math.max(min, Math.min(max, Math.floor(n)))
  }
  return {
    distro: assertSafeDistroName(o.distro),
    containerId: typeof o.containerId === 'string' ? o.containerId : undefined,
    shell: typeof o.shell === 'string' ? o.shell : undefined,
    cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
    user: typeof o.user === 'string' ? o.user : undefined,
    shellIntegration: o.shellIntegration === true,
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

export function registerPtyHandlers(
  add: AddFn,
  deps: {
    pty: PtyManager
    wsl: Pick<WslService, 'assertRunning'>
    shell?: Pick<ShellIntegrationService, 'homeDir' | 'status'>
  },
): void {
  const { pty } = deps

  add(CH.ptyCreate, async (ctx, arg: never) => {
    const o = asCreate(arg)
    // 未显式指定 shell 时：容器默认 /bin/sh（alpine 等没有 bash），发行版用设置默认 Shell
    if (!o.shell) o.shell = o.containerId ? '/bin/sh' : defaultShell(ctx)
    // 容器终端由 wslc 执行，不依赖发行版运行状态；发行版终端保持硬门禁
    if (!o.containerId) await deps.wsl.assertRunning(o.distro)
    // Shell 集成需要「已安装」+ home 目录：任一探测失败降级为普通终端，绝不阻塞开终端
    if (!o.containerId && o.shellIntegration && deps.shell) {
      try {
        const status = await deps.shell.status(o.distro, o.shell)
        if (status.state === 'installed') {
          o.homeDir = await deps.shell.homeDir(o.distro)
        } else {
          o.shellIntegration = false
        }
      } catch {
        o.shellIntegration = false
      }
    }
    return pty.create(o)
  })

  add(CH.ptyCreateProfile, async (ctx, arg: never) => {
    const o = (arg ?? {}) as { profileId?: string; cols?: number; rows?: number }
    const settings = ctx.configService.loadSync('settings')
    const profile = settings.terminal.profiles.find((p) => p.id === String(o.profileId ?? ''))
    if (!profile) {
      throw createAppError('INVALID_ARGUMENT', {
        message: `终端 profile 不存在：${String(o.profileId ?? '')}`,
      })
    }
    const cols = Math.max(2, Math.min(500, Math.floor(Number(o.cols) || 80)))
    const rows = Math.max(1, Math.min(200, Math.floor(Number(o.rows) || 24)))
    const launch = profile.launch

    if (launch.kind === 'container') {
      // 容器终端不依赖发行版运行状态
      return pty.create({
        distro: launch.containerId,
        containerId: launch.containerId,
        shell: launch.shell,
        env: launch.env,
        cols,
        rows,
      })
    }

    await deps.wsl.assertRunning(launch.distro)

    if (launch.kind === 'command') {
      return pty.createCommand({
        distro: launch.distro,
        program: launch.program,
        args: launch.args,
        user: launch.user,
        cwd: launch.cwd,
        cols,
        rows,
      })
    }

    const shell = launch.shell?.trim() || defaultShell(ctx)
    let shellIntegration = profile.shellIntegration === true
    let homeDir: string | undefined
    if (shellIntegration && deps.shell) {
      try {
        // 必须确认目标 shell 的集成文件「已安装」：仅探测 home 会让
        // `bash --rcfile 不存在` 直接启动失败（profile 不能信任过期状态）。
        const status = await deps.shell.status(launch.distro, shell)
        if (status.state !== 'installed') {
          shellIntegration = false
        } else {
          homeDir = await deps.shell.homeDir(launch.distro)
        }
      } catch {
        shellIntegration = false
      }
    }
    return pty.create({
      distro: launch.distro,
      shell,
      cwd: launch.cwd,
      user: launch.user,
      env: launch.env,
      shellIntegration,
      homeDir,
      cols,
      rows,
    })
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

  add(CH.ptyAck, (_c, arg: never) => {
    const o = (arg ?? {}) as { ptyId?: string; bytes?: number }
    pty.ack(asId(o.ptyId), Number(o.bytes ?? 0))
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
