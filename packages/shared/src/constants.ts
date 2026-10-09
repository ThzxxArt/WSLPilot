/**
 * 全局常量
 * 颜色 / 令牌一律来自 ./tokens.ts（唯一事实源）
 */
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

/** 强调色 → 主色（用于 Naive UI primary） */
export const ACCENT_PRIMARY = {
  aurora: '#6366F1',
  sunset: '#F59E0B',
  ocean: '#0EA5E9',
  forest: '#10B981',
  custom: '#6366F1',
} as const
