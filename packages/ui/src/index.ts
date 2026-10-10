import type { AccentName } from './tokens'
import { accentMaps } from './tokens'

/** 强调色切换过渡时长（§13.2：全局强调色 300ms 平滑过渡） */
const ACCENT_TRANSITION_MS = 320
let accentAnimTimer: ReturnType<typeof setTimeout> | null = null

/** 将强调色的 CSS 变量写入 :root，实现全局强调色切换 */
export function applyAccentToDom(accent: AccentName): void {
  const a = accentMaps[accent] ?? accentMaps.aurora
  const root = document.documentElement
  // 切换窗口内给颜色属性插过渡（motion.scss：:root[data-accent-anim]）
  root.dataset.accentAnim = 'true'
  if (accentAnimTimer !== null) clearTimeout(accentAnimTimer)
  accentAnimTimer = setTimeout(() => {
    root.dataset.accentAnim = 'false'
    accentAnimTimer = null
  }, ACCENT_TRANSITION_MS)

  root.style.setProperty('--color-accent', a.accent)
  root.style.setProperty('--color-accent-hover', a.accentHover)
  root.style.setProperty('--color-accent-soft', a.accentSoft)
  root.style.setProperty('--color-bg-active', a.bgActive)
  root.dataset.accent = accent
}

export * from './tokens'
export * from './naive'
export * from './composables/useNaiveTheme'
export * from './composables/useReducedMotion'
export * from './components'
export { vRipple } from './directives/vRipple'
