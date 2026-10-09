/**
 * 自定义动作执行器（M5）— ActionRunner。
 * 铁律（设计书 §4.3 / §9.6 / §14.2）：
 * - 只执行 actions.jsonc 中声明的动作 id（白名单），渲染层永远无法传任意命令
 * - 变量占位符在主进程替换，结果以参数数组执行，绝不经 shell 拼接
 * - terminal:true 复用临时 PTY（会话可在终端工作区查看，可取消）
 */
import {
  assertSafeActionId,
  assertSafeDistroName,
  collectActionVars,
  createAppError,
  previewActionCommand,
  resolveActionInvocation,
  type ActionVarContext,
  type DistroMeta,
  type TaskHandle,
  type WslAction,
} from '@wslpilot/shared'
import { getRawCommand, runWsl, type Logger } from '@wslpilot/kit'
import type { TaskControl } from './task-runner'
import { spawnWslTask, type SpawnWslFn } from './spawn-task'
import type { PtyManager, PtySessionInfo } from './pty-manager'

export interface PreparedAction {
  action: WslAction
  /** 目标发行版（global 动作也归一到具体发行版） */
  distro: string
  program: string
  args: string[]
  user?: string
  cwd?: string
  /** 等价命令行（界面展示 / 任务日志） */
  rawCommand: string
}

export interface ActionConfigReader {
  loadSync(key: 'actions'): { $schemaVersion: number; actions: WslAction[] }
  loadSync(key: 'distros'): { $schemaVersion: number; distros: DistroMeta[] }
}

export interface ActionRunnerDeps {
  logger: Logger
  configService: ActionConfigReader
  wsl: { list(): Promise<Array<{ name: string; isDefault: boolean }>> }
  pty: Pick<PtyManager, 'createCommand' | 'waitExit' | 'kill'>
  runWsl?: (
    args: string[],
    opts?: { timeoutMs?: number },
  ) => Promise<{
    stdout: string
    stderr: string
    code: number
  }>
  spawnFn?: SpawnWslFn
}

export interface ActionRunner {
  /** 解析 + 变量替换 + （必要时）探测 ${home}/${user} */
  prepare(actionId: string, distro?: string): Promise<PreparedAction>
  /** terminal:true 动作的临时 PTY（同步创建，ptyId 随 TaskHandle 返回） */
  spawnTerminal(prepared: PreparedAction): PtySessionInfo
  /** 执行到结束；terminal 动作等待 PTY 退出 */
  run(prepared: PreparedAction, ctl: TaskControl, ptyId?: string): Promise<void>
  /** 终止临时会话（任务启动失败时的兜底清理） */
  killSession(ptyId: string): void
}

/** ${home}/${user} 探测脚本（常量，不拼接任何用户输入） */
const PROBE_SCRIPT = 'printf "%s\\n%s\\n" "$HOME" "$USER"'

export function findAction(actions: readonly WslAction[], actionId: string): WslAction | null {
  return actions.find((a) => a.id === actionId) ?? null
}

export function createActionRunner(deps: ActionRunnerDeps): ActionRunner {
  const run = deps.runWsl ?? runWsl

  async function resolveDistro(action: WslAction, distro?: string): Promise<string> {
    if (distro && distro.trim()) return assertSafeDistroName(distro)
    if (action.scope === 'distro') {
      throw createAppError('DISTRO_NOT_FOUND', {
        message: `动作「${action.label}」是发行版级动作，需要指定发行版`,
        suggestion: '在发行版详情的「动作」标签中运行，或先选中一个发行版',
      })
    }
    // global：落到默认发行版（wsl 无 default 时用第一个）
    const list = await deps.wsl.list()
    const target = list.find((d) => d.isDefault) ?? list[0]
    if (!target) {
      throw createAppError('DISTRO_NOT_FOUND', {
        message: '没有可用的发行版来执行该动作',
        suggestion: '请先安装一个 WSL 发行版',
      })
    }
    return assertSafeDistroName(target.name)
  }

  function startupCwdOf(distro: string): string {
    const file = deps.configService.loadSync('distros')
    const meta = file.distros.find((d) => d.name === distro)
    return meta?.startupCwd?.trim() || '~'
  }

  async function probeUserEnv(distro: string): Promise<{ home: string; user: string }> {
    const r = await run(['-d', distro, '-e', 'sh', '-c', PROBE_SCRIPT], { timeoutMs: 15_000 })
    if (r.code !== 0) {
      throw createAppError('TASK_FAILED', {
        message: `无法解析 ${distro} 的用户环境（\${home}/\${user}）`,
        detail: (r.stderr || r.stdout).trim(),
        suggestion: '请确认发行版可正常启动后重试',
      })
    }
    const [homeRaw, userRaw] = r.stdout.split(/\r?\n/)
    const user = (userRaw ?? '').trim()
    const home = (homeRaw ?? '').trim() || (user ? `/home/${user}` : '')
    return { home, user }
  }

  return {
    async prepare(actionId, distro) {
      // 校验失败抛 CONFIG_INVALID（与 IPC 边界同一规则，双保险）
      const id = assertSafeActionId(actionId)
      const file = deps.configService.loadSync('actions')
      const action = findAction(file.actions ?? [], id)
      if (!action) {
        throw createAppError('TASK_FAILED', {
          message: `动作不存在：${id}`,
          detail: 'actions.jsonc 中未声明该 id（执行白名单）',
          suggestion: '请在 actions.jsonc 中定义该动作，或刷新动作列表',
        })
      }

      const target = await resolveDistro(action, distro)
      const varsText = [action.program, ...action.args, action.cwd ?? '', action.user ?? ''].join(
        '\n',
      )
      const needed = collectActionVars(varsText)
      const ctx: ActionVarContext = {
        distroName: target,
        startupCwd: startupCwdOf(target),
        home: '',
        user: '',
      }
      if (needed.includes('home') || needed.includes('user')) {
        const env = await probeUserEnv(target)
        ctx.home = env.home
        ctx.user = env.user
      }

      const inv = resolveActionInvocation(action, ctx)
      const rawCommand = previewActionCommand(action, ctx)
      deps.logger.info('action prepared', {
        actionId: action.id,
        distro: target,
        terminal: action.terminal,
        rawCommand: getRawCommand('wsl.exe', ['-d', target]),
      })
      return {
        action,
        distro: target,
        program: inv.program,
        args: inv.args,
        user: inv.user,
        cwd: inv.cwd,
        rawCommand,
      }
    },

    spawnTerminal(prepared) {
      return deps.pty.createCommand({
        distro: prepared.distro,
        program: prepared.program,
        args: prepared.args,
        user: prepared.user,
        cwd: prepared.cwd,
      })
    },

    async run(prepared, ctl, ptyId) {
      const { action } = prepared
      ctl.log(`$ ${prepared.rawCommand}`)

      if (action.terminal && ptyId) {
        // 终端动作：输出走 PTY（终端工作区可见）；任务只负责生命周期
        ctl.report(null, `在终端中运行：${action.label}`)
        const exit = deps.pty.waitExit(ptyId)
        ctl.onCancel(() => deps.pty.kill(ptyId))
        const code = await exit
        if (ctl.isCanceled()) {
          throw createAppError('TASK_CANCELED', { message: `动作已取消：${action.label}` })
        }
        if (code !== 0) {
          throw createAppError('TASK_FAILED', {
            message: `动作「${action.label}」退出码 ${code}`,
            rawCommand: prepared.rawCommand,
            suggestion: '请在终端标签中查看完整输出',
          })
        }
        ctl.report(100, `动作完成：${action.label}`)
        ctl.log(`动作完成：${action.label}（exit ${code}）`)
        return
      }

      const argv = ['-d', prepared.distro]
      if (prepared.user) argv.push('-u', prepared.user)
      if (prepared.cwd && prepared.cwd.trim() && prepared.cwd.trim() !== '~') {
        argv.push('--cd', prepared.cwd.trim())
      }
      argv.push('-e', prepared.program, ...prepared.args)

      ctl.report(0, `正在运行：${action.label}`)
      await spawnWslTask(argv, ctl, deps.logger, deps.spawnFn)
      ctl.report(100, `动作完成：${action.label}`)
      ctl.log(`动作完成：${action.label}`)
    },

    killSession(ptyId) {
      try {
        deps.pty.kill(ptyId)
      } catch (e) {
        deps.logger.warn('action pty kill failed', { ptyId, error: String(e) })
      }
    },
  }
}

/** handler 便捷：构造 TaskHandle（含 terminal 动作的 ptyId 与目标发行版） */
export function actionTaskHandle(
  taskId: string,
  info?: Pick<PtySessionInfo, 'ptyId'> | null,
  distro?: string,
): TaskHandle {
  return {
    taskId,
    ...(info ? { ptyId: info.ptyId } : {}),
    ...(distro ? { distro } : {}),
  }
}
