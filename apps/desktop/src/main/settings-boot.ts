/**
 * 启动早期设置（须在 app.ready 之前生效的部分）。
 * 当前仅 hardwareAcceleration：Electron 要求 disableHardwareAcceleration 在 ready 前调用。
 * 与 ConfigService 分离：ConfigService 依赖 chokidar/异步，bootstrap 前不可用。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_FILE_NAMES } from '@wslpilot/shared'
import { parseJsoncSafe } from '@wslpilot/kit'

export interface BootSettings {
  hardwareAcceleration: boolean
}

export const DEFAULT_BOOT_SETTINGS: BootSettings = { hardwareAcceleration: true }

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
