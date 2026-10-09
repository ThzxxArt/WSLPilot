import type { AccentName } from './tokens'
import { accentMaps } from './tokens'

/** 将强调色的 CSS 变量写入 :root，实现全局强调色切换 */
export function applyAccentToDom(accent: AccentName): void {
  const a = accentMaps[accent] ?? accentMaps.aurora
  const root = document.documentElement
  root.style.setProperty('--color-accent', a.accent)
  root.style.setProperty('--color-accent-hover', a.accentHover)
  root.style.setProperty('--color-accent-soft', a.accentSoft)
  root.style.setProperty('--color-bg-active', a.bgActive)
  root.dataset.accent = accent
}

export * from './tokens'
export * from './naive'
export * from './composables/useNaiveTheme'
