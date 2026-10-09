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

export interface TerminalFontPrefs {
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  scrollback: number
}

export const DEFAULT_TERMINAL_PREFS: TerminalFontPrefs = {
  fontFamily: 'Cascadia Mono, Consolas, monospace',
  fontSize: 14,
  lineHeight: 1.2,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
}
