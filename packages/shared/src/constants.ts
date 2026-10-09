/** 全局常量 */

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

/** 发行版品牌色映射 */
export const DISTRO_BRAND_COLORS: Record<string, string> = {
  Ubuntu: '#E95420',
  Debian: '#A80030',
  Fedora: '#51A2DA',
  Arch: '#1793D1',
  openSUSE: '#73BA25',
  Kali: '#557C94',
  Alpine: '#0D597F',
}

/** 强调色 → 渐变定义 */
export const ACCENT_GRADIENTS = {
  aurora: 'linear-gradient(135deg, #22D3EE 0%, #6366F1 50%, #A855F7 100%)',
  sunset: 'linear-gradient(135deg, #FB7185 0%, #F59E0B 100%)',
  ocean: 'linear-gradient(135deg, #38BDF8 0%, #0EA5E9 50%, #2563EB 100%)',
  forest: 'linear-gradient(135deg, #34D399 0%, #10B981 50%, #059669 100%)',
  custom: 'linear-gradient(135deg, #22D3EE 0%, #6366F1 50%, #A855F7 100%)',
} as const

/** 强调色 → 主色（用于 Naive UI primary） */
export const ACCENT_PRIMARY = {
  aurora: '#6366F1',
  sunset: '#F59E0B',
  ocean: '#0EA5E9',
  forest: '#10B981',
  custom: '#6366F1',
} as const
