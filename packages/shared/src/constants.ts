/**
 * 全局常量
 * 颜色 / 令牌一律来自 ./tokens.ts（唯一事实源）
 */
import { ACCENT_MAPS } from './tokens'

export {
  PRIMITIVE_GRADIENTS as ACCENT_GRADIENTS,
  ACCENT_MAPS,
  DISTRO_BRAND_COLORS,
  type AccentName,
} from './tokens'

export const APP_NAME = 'WSLPilot'
export const APP_ID = 'com.wslpilot.app'
export const CURRENT_SETTINGS_VERSION = 2

/** 配置文件键 → 文件名 */
export const CONFIG_FILE_NAMES = {
  settings: 'settings.jsonc',
  distros: 'distros.jsonc',
  actions: 'actions.jsonc',
  network: 'network.jsonc',
  uiState: 'ui-state.jsonc',
  state: 'state.jsonc',
} as const

/** 配置备份保留份数 */
export const CONFIG_BACKUP_KEEP = 3

/** PTY 会话上限 */
export const MAX_PTY_SESSIONS = 10

/** 默认轮询间隔 */
export const DEFAULT_POLL_INTERVAL_MS = 5000

/** 强调色 → 主色（从 ACCENT_MAPS 派生，禁止另一套色值） */
export const ACCENT_PRIMARY = Object.fromEntries(
  Object.entries(ACCENT_MAPS).map(([k, v]) => [k, v.accent]),
) as Record<keyof typeof ACCENT_MAPS, string>
