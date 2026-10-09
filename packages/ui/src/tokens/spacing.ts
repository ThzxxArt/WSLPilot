/**
 * 间距 / 圆角 / 阴影 / 层级 — 唯一事实源在 @wslpilot/shared/tokens
 * 本文件仅做键名适配，禁止新增数值。
 */
import { SPACING, RADIUS, SHADOW, Z_INDEX } from '@wslpilot/shared'

export const spacing = {
  1: SPACING['space-1'],
  2: SPACING['space-2'],
  3: SPACING['space-3'],
  4: SPACING['space-4'],
  5: SPACING['space-5'],
  6: SPACING['space-6'],
  8: SPACING['space-8'],
  10: SPACING['space-10'],
  16: SPACING['space-16'],
} as const

export const radius = {
  xs: RADIUS['radius-xs'],
  sm: RADIUS['radius-sm'],
  md: RADIUS['radius-md'],
  lg: RADIUS['radius-lg'],
  xl: RADIUS['radius-xl'],
  full: RADIUS['radius-full'],
} as const

export const shadow = {
  xs: SHADOW['shadow-xs'],
  sm: SHADOW['shadow-sm'],
  md: SHADOW['shadow-md'],
  lg: SHADOW['shadow-lg'],
  glow: SHADOW['shadow-glow'],
} as const

export const z = {
  base: Number(Z_INDEX['z-base']),
  dropdown: Number(Z_INDEX['z-dropdown']),
  sticky: Number(Z_INDEX['z-sticky']),
  drawer: Number(Z_INDEX['z-drawer']),
  modal: Number(Z_INDEX['z-modal']),
  toast: Number(Z_INDEX['z-toast']),
  tooltip: Number(Z_INDEX['z-tooltip']),
  command: Number(Z_INDEX['z-command']),
} as const
