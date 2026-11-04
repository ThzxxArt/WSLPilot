/**
 * Shell 集成服务（0.2.0）：检测 / 安装 / 移除 `~/.wslpilot/shell-integration/`。
 *
 * - 只写固定目录，不触碰用户 rc；
 * - 写入用 `wsl -e tee <path>` + stdin（内容不经 shell 拼接）；
 * - 所有 argv 都是常量或经过 Linux 绝对路径校验的路径；
 * - 探测/安装失败按 AppError 返回，UI 显示横幅而不是静默失败。
 */
import {
  assertLinuxContainerPath,
  BASH_RC_TEMPLATE,
  SHELL_INTEGRATION_FILES,
  SHELL_INTEGRATION_VERSION,
  shellIntegrationDir,
  shellIntegrationStatusFromProbe,
  ZSH_RC_TEMPLATE,
  createAppError,
  type ShellIntegrationStatus,
} from '@wslpilot/shared'
import { runWsl, runWslWithStdin, type Logger } from '@wslpilot/kit'

export interface ShellIntegrationServiceDeps {
  logger: Logger
  runWsl?: typeof runWsl
  runWslWithStdin?: typeof runWslWithStdin
}

export interface ShellIntegrationService {
  /** 读取（并缓存）发行版 home 目录 */
  homeDir(distro: string): Promise<string>
  status(distro: string, shell?: string): Promise<ShellIntegrationStatus>
  install(distro: string, shell?: string): Promise<ShellIntegrationStatus>
  remove(distro: string, shell?: string): Promise<ShellIntegrationStatus>
  invalidateCache(distro?: string): void
}

const HOME_CACHE_MS = 60_000

function fail(message: string, detail: string): never {
  throw createAppError('TASK_FAILED', {
    message,
    detail: detail.trim().slice(0, 2000),
    suggestion: '请确认发行版正在运行，且当前用户对 home 目录有写权限',
  })
}

export function createShellIntegrationService(
  deps: ShellIntegrationServiceDeps,
): ShellIntegrationService {
  const run = deps.runWsl ?? runWsl
  const runStdin = deps.runWslWithStdin ?? runWslWithStdin
  const homes = new Map<string, { at: number; home: string }>()

  async function probeHome(distro: string): Promise<string> {
    const cached = homes.get(distro)
    if (cached && Date.now() - cached.at < HOME_CACHE_MS) return cached.home
    const r = await run(['-d', distro, '-e', 'printenv', 'HOME'], { encoding: 'utf8' })
    if (r.code !== 0) fail(`读取 ${distro} 的 home 目录失败`, r.stderr || r.stdout)
    const home = assertLinuxContainerPath(r.stdout.trim())
    homes.set(distro, { at: Date.now(), home })
    return home
  }

  async function exists(distro: string, path: string): Promise<boolean> {
    const r = await run(['-d', distro, '-e', 'test', '-f', path], { encoding: 'utf8' })
    return r.code === 0
  }

  async function readVersion(distro: string, path: string): Promise<string> {
    const r = await run(['-d', distro, '-e', 'cat', path], { encoding: 'utf8' })
    return r.code === 0 ? r.stdout.trim() : ''
  }

  async function status(distro: string, shell = '/bin/bash'): Promise<ShellIntegrationStatus> {
    const home = await probeHome(distro)
    const bashrc = `${home}/${SHELL_INTEGRATION_FILES.bashrc}`
    const zshrc = `${home}/${SHELL_INTEGRATION_FILES.zshrc}`
    const versionPath = `${home}/${SHELL_INTEGRATION_FILES.version}`
    const [bashExists, zshExists, version] = await Promise.all([
      exists(distro, bashrc),
      exists(distro, zshrc),
      readVersion(distro, versionPath),
    ])
    return shellIntegrationStatusFromProbe(distro, shell, {
      home,
      files: { bashrc: bashExists, zshrc: zshExists },
      version,
    })
  }

  async function writeFile(distro: string, path: string, content: string): Promise<void> {
    const r = await runStdin(['-d', distro, '-e', 'tee', path], content, {
      encoding: 'utf8',
      timeoutMs: 30_000,
    })
    if (r.code !== 0) fail(`写入 ${path} 失败`, r.stderr || r.stdout)
  }

  async function install(distro: string, shell = '/bin/bash'): Promise<ShellIntegrationStatus> {
    const home = await probeHome(distro)
    const dir = shellIntegrationDir(home)
    // 先建目录（argv 常量，不经 shell）；-p 幂等
    const mk = await run(['-d', distro, '-e', 'mkdir', '-p', `${dir}/zsh`], { encoding: 'utf8' })
    if (mk.code !== 0) fail(`创建 ${dir} 失败`, mk.stderr || mk.stdout)

    await writeFile(distro, `${dir}/bashrc`, BASH_RC_TEMPLATE)
    await writeFile(distro, `${dir}/zsh/.zshrc`, ZSH_RC_TEMPLATE)
    await writeFile(distro, `${dir}/version`, SHELL_INTEGRATION_VERSION)
    deps.logger.info('shell integration installed', { distro, path: dir })
    return status(distro, shell)
  }

  async function remove(distro: string, shell = '/bin/bash'): Promise<ShellIntegrationStatus> {
    const home = await probeHome(distro)
    const dir = shellIntegrationDir(home)
    const r = await run(['-d', distro, '-e', 'rm', '-rf', dir], { encoding: 'utf8' })
    if (r.code !== 0) fail(`移除 ${dir} 失败`, r.stderr || r.stdout)
    deps.logger.info('shell integration removed', { distro, path: dir })
    return status(distro, shell)
  }

  return {
    homeDir: probeHome,
    status,
    install,
    remove,
    invalidateCache: (distro) => {
      if (distro) homes.delete(distro)
      else homes.clear()
    },
  }
}
