/**
 * Shell 集成（0.2.0）— 固定模板与启动参数的唯一事实源。
 *
 * 铁律：
 * - 只写 `~/.wslpilot/shell-integration/`，**绝不修改**用户 `~/.bashrc` / `~/.zshrc`；
 * - 模板是静态常量，不拼接任何用户输入；
 * - 移除 = 删除目录，用户原配置恢复原状；
 * - 终端启动只通过 argv 传递路径，不经过字符串拼接的 shell 命令。
 */
import type { ShellIntegrationStatus, ShellKind } from './types'

export const SHELL_INTEGRATION_VERSION = '1'
export const SHELL_INTEGRATION_DIR = '.wslpilot/shell-integration'

/** bash：先加载用户 rc，再注入 OSC 133/7；PS0 标记输出开始，PROMPT_COMMAND 标记提示符与退出码 */
export const BASH_RC_TEMPLATE = String.raw`# WSLPilot shell integration v1
# 由 WSLPilot 生成，请勿手改。
# 移除：删除 ~/.wslpilot/shell-integration 目录（用户自己的 rc 文件从未被修改）。
if [ -f "$HOME/.bashrc" ]; then
  . "$HOME/.bashrc"
fi

__WSLPILOT_B=$'\[\e]133;B\a\]'
__wp_osc() { printf '\033]%s\007' "$1"; }

__wp_prompt_command() {
  local __wp_ec=$?
  if [ -n "@@{__WSLPILOT_CMD_ACTIVE:-}" ]; then
    __wp_osc "133;D;$__wp_ec"
    __WSLPILOT_CMD_ACTIVE=
  fi
  __WSLPILOT_CMD_ACTIVE=1
  __wp_osc "133;A"
  printf '\033]7;file://%s%s\007' "@@{HOSTNAME:-localhost}" "@@{PWD:-/}"
  case "$PS1" in
    *"$__WSLPILOT_B"*) ;;
    *) PS1="$PS1$__WSLPILOT_B" ;;
  esac
}
PROMPT_COMMAND="__wp_prompt_command@@{PROMPT_COMMAND:+;$PROMPT_COMMAND}"
PS0='\e]133;C\a'
`.replaceAll('@@{', '${')

/** zsh：ZDOTDIR 指向集成目录；先 source 用户 zshrc，再挂 precmd/preexec */
export const ZSH_RC_TEMPLATE = String.raw`# WSLPilot shell integration v1
# 由 WSLPilot 生成，请勿手改。
# 移除：删除 ~/.wslpilot/shell-integration 目录（用户自己的 rc 文件从未被修改）。
if [ -n "@@{WSLPILOT_ORIGINAL_ZDOTDIR:-}" ] && [ -f "$WSLPILOT_ORIGINAL_ZDOTDIR/.zshrc" ]; then
  source "$WSLPILOT_ORIGINAL_ZDOTDIR/.zshrc"
elif [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc"
fi

__wp_osc() { printf '\033]%s\007' "$1"; }
__wp_precmd() {
  local __wp_ec=$?
  if [ -n "@@{__WSLPILOT_CMD_ACTIVE:-}" ]; then
    __wp_osc "133;D;$__wp_ec"
    __WSLPILOT_CMD_ACTIVE=
  fi
  __WSLPILOT_CMD_ACTIVE=1
  __wp_osc "133;A"
  printf '\033]7;file://%s%s\007' "@@{HOST:-localhost}" "$PWD"
  case "$PROMPT" in
    *$'\e]133;B'*) ;;
    *) PROMPT="@@{PROMPT}"$'%{\e]133;B\a%}' ;;
  esac
}
__wp_preexec() {
  printf '\033]133;C\007'
}
autoload -Uz add-zsh-hook 2>/dev/null
if type add-zsh-hook >/dev/null 2>&1; then
  add-zsh-hook precmd __wp_precmd
  add-zsh-hook preexec __wp_preexec
else
  precmd_functions+=(__wp_precmd)
  preexec_functions+=(__wp_preexec)
fi
`.replaceAll('@@{', '${')

/** 模板文件清单（相对 home） */
export const SHELL_INTEGRATION_FILES = {
  bashrc: `${SHELL_INTEGRATION_DIR}/bashrc`,
  zshrc: `${SHELL_INTEGRATION_DIR}/zsh/.zshrc`,
  version: `${SHELL_INTEGRATION_DIR}/version`,
} as const

export function shellIntegrationDir(home: string): string {
  return `${home.replace(/\/+$/, '')}/${SHELL_INTEGRATION_DIR}`
}

/** 由 shell 路径/名称推断类型（`/bin/bash`、`bash`、`/usr/bin/zsh`） */
export function resolveShellKind(shell: string | undefined | null): ShellKind {
  const base = String(shell ?? '')
    .trim()
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase()
  if (base === 'bash') return 'bash'
  if (base === 'zsh') return 'zsh'
  if (base === 'fish') return 'fish'
  return 'unknown'
}

/** 该 shell 是否支持自动安装 Shell 集成 */
export function isShellIntegrationSupported(shell: string | undefined | null): boolean {
  const kind = resolveShellKind(shell)
  return kind === 'bash' || kind === 'zsh'
}

/**
 * 终端启动参数（在 `wsl -d <distro> --cd ...` 之后）：
 * - bash：`-e <shell> --rcfile <dir>/bashrc -i`
 * - zsh：`-e env ZDOTDIR=<dir>/zsh WSLPILOT_ORIGINAL_ZDOTDIR=<home> <shell> -i`
 * - 其他：`-e <shell>`（不支持集成，行为不变）
 */
export function shellIntegrationLaunchArgs(
  shell: string,
  home: string,
  env: Record<string, string> = {},
): { args: string[]; integrated: boolean } {
  const kind = resolveShellKind(shell)
  const envPairs = Object.entries(env)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
  if (kind === 'bash') {
    return {
      args: [
        '-e',
        ...(envPairs.length ? ['env', ...envPairs] : []),
        shell,
        '--rcfile',
        `${shellIntegrationDir(home)}/bashrc`,
        '-i',
      ],
      integrated: true,
    }
  }
  if (kind === 'zsh') {
    return {
      args: [
        '-e',
        'env',
        ...envPairs,
        `ZDOTDIR=${shellIntegrationDir(home)}/zsh`,
        `WSLPILOT_ORIGINAL_ZDOTDIR=${home.replace(/\/+$/, '')}`,
        shell,
        '-i',
      ],
      integrated: true,
    }
  }
  return {
    args: ['-e', ...(envPairs.length ? ['env', ...envPairs] : []), shell],
    integrated: false,
  }
}

export interface ShellIntegrationProbe {
  home: string
  /** 各文件存在性（由 `test -f` 探测） */
  files: { bashrc: boolean; zshrc: boolean }
  /** version 文件内容（不存在为空） */
  version: string
}

/** 探测结果 → 用户可见状态（唯一判定入口） */
export function shellIntegrationStatusFromProbe(
  distro: string,
  shell: string | undefined,
  probe: ShellIntegrationProbe,
): ShellIntegrationStatus {
  const kind = resolveShellKind(shell)
  const supported = kind === 'bash' || kind === 'zsh'
  const versionMatches = probe.version.trim() === SHELL_INTEGRATION_VERSION
  const targetInstalled =
    kind === 'bash' ? probe.files.bashrc : kind === 'zsh' ? probe.files.zshrc : false
  let state: ShellIntegrationStatus['state']
  if (!supported) state = 'unsupported'
  else if (targetInstalled && versionMatches) state = 'installed'
  else if (probe.files.bashrc || probe.files.zshrc) state = 'partial'
  else state = 'missing'
  return {
    distro,
    shell: kind,
    state,
    supported,
    version: probe.version.trim(),
    expectedVersion: SHELL_INTEGRATION_VERSION,
    path: `${probe.home.replace(/\/+$/, '')}/${SHELL_INTEGRATION_DIR}`,
    files: probe.files,
  }
}
