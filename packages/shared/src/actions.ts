/**
 * 自定义动作（actions.jsonc）纯助手 — M5。
 * 变量占位符替换与等价命令行预览在主/渲染共享：
 * 渲染层展示「将要执行的命令」，主进程执行同一构建结果，二者绝不各写一份（设计书 §9.6）。
 */
import type { WslAction } from './types'
import { formatCommand } from './commands'
import { createAppError } from './errors'

/** 动作变量上下文（主进程解析后传入） */
export interface ActionVarContext {
  distroName: string
  startupCwd: string
  home: string
  user: string
}

export const ACTION_VAR_NAMES = ['distroName', 'startupCwd', 'home', 'user'] as const

/** 文本中引用到的变量名（用于决定是否需要探测 ${home}/${user}） */
export function collectActionVars(text: string): string[] {
  const found = new Set<string>()
  const re = /\$\{([A-Za-z][A-Za-z0-9]*)}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const name = m[1]!
    if ((ACTION_VAR_NAMES as readonly string[]).includes(name)) found.add(name)
  }
  return [...found]
}

/**
 * 安全替换变量占位符：结果不经过 shell，替换只是纯字符串拼接。
 * 未知占位符（如 ${foo}）原样保留，交给用户在等价命令里看得见。
 */
export function substituteActionVars(text: string, ctx: ActionVarContext): string {
  return text.replace(/\$\{([A-Za-z][A-Za-z0-9]*)}/g, (match, name: string) => {
    switch (name) {
      case 'distroName':
        return ctx.distroName
      case 'startupCwd':
        return ctx.startupCwd
      case 'home':
        return ctx.home
      case 'user':
        return ctx.user
      default:
        return match
    }
  })
}

/** 替换动作的 program/args/cwd/user（不含执行） */
export function resolveActionInvocation(
  action: WslAction,
  ctx: ActionVarContext,
): { program: string; args: string[]; cwd?: string; user?: string } {
  return {
    program: substituteActionVars(action.program, ctx),
    args: action.args.map((a) => substituteActionVars(a, ctx)),
    cwd: action.cwd === undefined ? undefined : substituteActionVars(action.cwd, ctx),
    user: action.user === undefined ? undefined : substituteActionVars(action.user, ctx),
  }
}

/**
 * 等价命令行（仅界面展示，绝不用于执行）。
 * 形态与真实执行一致：`wsl.exe -d <distro> [-u user] [--cd cwd] -e <program> <args...>`。
 */
export function previewActionCommand(action: WslAction, ctx: ActionVarContext): string {
  const inv = resolveActionInvocation(action, ctx)
  const args = ['-d', ctx.distroName]
  if (inv.user) args.push('-u', inv.user)
  if (inv.cwd && inv.cwd.trim() && inv.cwd.trim() !== '~') args.push('--cd', inv.cwd.trim())
  args.push('-e', inv.program, ...inv.args)
  return formatCommand('wsl.exe', args)
}

/**
 * 展示用等价命令（渲染层）：${home}/${user} 保持占位符（主进程运行前才探测）。
 */
export function previewActionCommandForDistro(
  action: WslAction,
  distroName: string,
  startupCwd: string,
): string {
  return previewActionCommand(action, {
    distroName,
    startupCwd,
    home: '${home}',
    user: '${user}',
  })
}

/** 动作 id 安全校验（执行白名单的键）：非空、≤100、无控制字符与文件名非法字符 */
export function assertSafeActionId(id: unknown): string {
  const s = typeof id === 'string' ? id.trim() : ''
  const bad = (msg: string): never => {
    throw createAppError('CONFIG_INVALID', {
      message: msg,
      suggestion: '动作 id 不得包含 \\ / : * ? " < > | 或控制字符，长度 1–100',
    })
  }
  if (!s || s.length > 100) bad('动作 id 非法（空或超过 100 字符）')
  // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
  if (/[\u0000-\u001f\u007f]/.test(s)) bad('动作 id 非法（含控制字符）')
  if (/[\\/:*?"<>|]/.test(s)) bad('动作 id 非法（含非法字符）')
  return s
}
