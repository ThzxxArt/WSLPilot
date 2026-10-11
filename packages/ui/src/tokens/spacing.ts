/**
 * 圆角 / 阴影 / 层级 — 唯一事实源在 @wslpilot/shared/tokens
 * 本文件仅做键名适配，禁止新增数值。
 * （space-* 间距档全仓零消费已根治：SPACING 与 spacing 适配层一并删除；
 *   shadow 仅保留 utilities.scss 有消费的 xs/md，z 仅保留 --z-toast 对应的 toast。）
 */
import { RADIUS, SHADOW, Z_INDEX } from '@wslpilot/shared'

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
  md: SHADOW['shadow-md'],
} as const

export const z = {
  toast: Number(Z_INDEX['z-toast']),
} as const
