/** 间距（4px 基准） */
export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  16: '64px',
} as const

/** 圆角 */
export const radius = {
  xs: '6px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  full: '9999px',
} as const

/** 阴影（浅色主题：柔和多层，带蓝色调） */
export const shadow = {
  xs: '0 1px 2px rgba(15,23,42,.06)',
  sm: '0 2px 6px rgba(15,23,42,.08)',
  md: '0 6px 16px -4px rgba(15,23,42,.12), 0 2px 6px -2px rgba(15,23,42,.08)',
  lg: '0 16px 40px -12px rgba(15,23,42,.22)',
  glow: '0 0 0 1px var(--color-border-default), 0 8px 32px -8px var(--color-accent-soft)',
} as const

/** 层级 */
export const z = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  drawer: 1200,
  modal: 1300,
  toast: 1400,
  tooltip: 1500,
  command: 1600,
} as const
