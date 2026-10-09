import { defaultConfig } from '@shared/config-schema'
import { ACCENT_MAPS } from '@shared/constants'
import type { AccentName, TerminalTheme } from '@shared/types'

/** 明亮终端配色 — 与浅色应用协调（设计书 §12.5） */
export const TERMINAL_LIGHT_THEME = {
  background: '#FBFCFE',
  foreground: '#1E293B',
  cursor: '#6366F1',
  cursorAccent: '#FBFCFE',
  selectionBackground: 'rgba(99, 102, 241, 0.25)',
  black: '#0F172A',
  red: '#DC2626',
  green: '#16A34A',
  yellow: '#D97706',
  blue: '#2563EB',
  magenta: '#A855F7',
  cyan: '#0891B2',
  white: '#E2E8F0',
  brightBlack: '#64748B',
  brightRed: '#EF4444',
  brightGreen: '#22C55E',
  brightYellow: '#F59E0B',
  brightBlue: '#3B82F6',
  brightMagenta: '#C084FC',
  brightCyan: '#06B6D4',
  brightWhite: '#F8FAFC',
} as const

/** 高对比浅色（terminal.theme = custom）— 满足正文 ≥ 4.5:1 对比度 */
export const TERMINAL_CONTRAST_THEME = {
  background: '#FFFFFF',
  foreground: '#0B1220',
  cursor: '#0B1220',
  cursorAccent: '#FFFFFF',
  selectionBackground: 'rgba(15, 23, 42, 0.28)',
  black: '#000000',
  red: '#B91C1C',
  green: '#15803D',
  yellow: '#B45309',
  blue: '#1D4ED8',
  magenta: '#7E22CE',
  cyan: '#0E7490',
  white: '#E5E7EB',
  brightBlack: '#475569',
  brightRed: '#DC2626',
  brightGreen: '#16A34A',
  brightYellow: '#D97706',
  brightBlue: '#2563EB',
  brightMagenta: '#9333EA',
  brightCyan: '#0891B2',
  brightWhite: '#FFFFFF',
} as const

export interface TerminalFontPrefs {
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
}

/** 默认终端偏好唯一事实源：settings.jsonc schema 默认值（禁止第三份手抄 — review） */
const _defaults = defaultConfig('settings').terminal
export const DEFAULT_TERMINAL_PREFS: TerminalFontPrefs = {
  fontFamily: _defaults.fontFamily,
  fontSize: _defaults.fontSize,
  lineHeight: _defaults.lineHeight,
  cursorStyle: _defaults.cursorStyle,
  cursorBlink: _defaults.cursorBlink,
  scrollback: _defaults.scrollback,
}

/** #rrggbb → rgba()（xterm 主题选区着色） */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(99, 102, 241, ${alpha})`
  const n = Number.parseInt(m[1]!, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * 终端主题解析（settings.terminal.theme）：
 * - auto：内置浅色（默认）
 * - follow-app：内置浅色 + 当前强调色光标/选区
 * - custom：高对比浅色
 */
export function resolveTerminalTheme(
  mode: TerminalTheme,
  accent: AccentName = 'aurora',
): Record<string, string> {
  if (mode === 'custom') return { ...TERMINAL_CONTRAST_THEME }
  if (mode === 'follow-app') {
    const color = ACCENT_MAPS[accent]?.accent ?? ACCENT_MAPS.aurora.accent
    return { ...TERMINAL_LIGHT_THEME, cursor: color, selectionBackground: hexToRgba(color, 0.25) }
  }
  return { ...TERMINAL_LIGHT_THEME }
}
