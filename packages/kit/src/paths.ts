import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * 路径解析。
 * 注意：主进程运行时应优先使用 Electron 的 app.getPath('userData')，
 * 此处提供无 Electron 依赖的回退实现（供测试与 kit 独立使用）。
 */
export function defaultUserDataDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData) return join(appData, 'WSLPilot')
    return join(homedir(), 'AppData', 'Roaming', 'WSLPilot')
  }
  // 开发/测试环境（WSL / macOS / Linux）
  return join(homedir(), '.config', 'WSLPilot')
}

export function configFilePath(userDataDir: string, fileName: string): string {
  return join(userDataDir, fileName)
}

export function backupsDir(userDataDir: string): string {
  return join(userDataDir, 'backups')
}

export function logsDir(userDataDir: string): string {
  return join(userDataDir, 'logs')
}

/**
 * 规范化并校验路径，拒绝 `..` 逃逸与绝对路径输入（review m5）。
 * base 为允许的根目录。
 */
export function safeResolve(base: string, relative: string): string {
  const normalized = relative.replace(/\\/g, '/')
  if (normalized.includes('\0')) {
    throw new Error('路径包含非法字符')
  }
  // 绝对路径 / 盘符 / UNC 输入静默"降级为相对"语义意外 — 显式拒绝
  if (/^([a-zA-Z]:)?\//.test(normalized) || normalized.startsWith('//')) {
    throw new Error('不允许绝对路径')
  }
  const parts = normalized.split('/').filter((p) => p !== '' && p !== '.')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '..') {
      if (stack.length === 0) throw new Error('路径逃逸被拒绝')
      stack.pop()
    } else {
      stack.push(part)
    }
  }
  return join(base, ...stack)
}

/**
 * 展开 %USERPROFILE% 等 Windows 风格环境变量。
 * 大小写不敏感（Windows 环境变量语义）；未知变量原样保留。
 */
export function expandEnv(input: string): string {
  return input.replace(/%([^%]+)%/g, (match, name: string) => {
    const upper = name.toUpperCase()
    const direct = process.env[upper] ?? process.env[name]
    return direct ?? match
  })
}
