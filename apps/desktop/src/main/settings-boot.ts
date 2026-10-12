/**
 * 启动早期设置（须在 app.ready 之前生效的部分）。
 * 当前仅 hardwareAcceleration：Electron 要求 disableHardwareAcceleration 在 ready 前调用。
 * 与 ConfigService 分离：ConfigService 依赖 chokidar/异步，bootstrap 前不可用。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_FILE_NAMES } from '@wslpilot/shared'
import { parseJsoncSafe } from '@wslpilot/kit'

export interface BootSettings {
  hardwareAcceleration: boolean
}

export const DEFAULT_BOOT_SETTINGS: BootSettings = { hardwareAcceleration: true }

/**
 * userData 目录环境变量覆写（E2E / 测试隔离）。
 * `WSLPILOT_USER_DATA` 指向临时目录时，配置/日志/备份全部落该目录，
 * 不触碰真实用户数据，视觉基线与冒烟不受本机设置影响（review E2E 隔离根治）。
 * 必须在单实例锁与 app ready 之前应用（锁与路径都基于 userData）。
 */
export function resolveUserDataOverride(env: NodeJS.ProcessEnv): string | null {
  const p = String(env.WSLPILOT_USER_DATA ?? '').trim()
  return p ? p : null
}

/**
 * 确保 override 目录存在并返回同一路径。
 * Electron 文档明确：`app.setPath('userData', p)` 在目录不存在时会抛错
 * —— 调用方必须先建目录，否则用户指向新路径时应用启动即崩（review 根治）。
 * 幂等（已存在时 no-op）。
 */
export function ensureUserDataDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

/**
 * 同步读取 settings.jsonc 的启动期字段。
 * 任何失败（缺文件/损坏/类型不符）都降级为默认值，绝不阻断启动。
 */
export function readBootSettings(userDataDir: string): BootSettings {
  try {
    const text = readFileSync(join(userDataDir, CONFIG_FILE_NAMES.settings), 'utf8')
    const parsed = parseJsoncSafe<Record<string, unknown>>(text)
    const data = parsed.data
    if (!data || typeof data !== 'object') return { ...DEFAULT_BOOT_SETTINGS }
    const advanced = data.advanced
    const hw =
      advanced && typeof advanced === 'object'
        ? (advanced as Record<string, unknown>).hardwareAcceleration
        : undefined
    return { hardwareAcceleration: hw !== false }
  } catch {
    return { ...DEFAULT_BOOT_SETTINGS }
  }
}
