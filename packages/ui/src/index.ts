import type { AccentName } from './tokens'
import { accentMaps, motion } from './tokens'

/** 强调色切换过渡时长（§13.2：320ms 平滑过渡；引用 motion dur-slow 令牌，禁止魔法数） */
const ACCENT_TRANSITION_MS = Number.parseInt(motion.duration.slow, 10)
let accentAnimTimer: ReturnType<typeof setTimeout> | null = null

/** 将强调色的 CSS 变量写入 :root，实现全局强调色切换 */
export function applyAccentToDom(accent: AccentName): void {
  // SSR 守卫（与 vRipple 一致）：无 document 环境直接放弃 DOM 写入
  if (typeof document === 'undefined') return
  const a = accentMaps[accent] ?? accentMaps.aurora
  const root = document.documentElement
  // 切换窗口内给颜色属性插过渡（motion.scss：:root[data-accent-anim='true']）
  root.setAttribute('data-accent-anim', 'true')
  if (accentAnimTimer !== null) clearTimeout(accentAnimTimer)
  accentAnimTimer = setTimeout(() => {
    // 属性语义（review 0.1.2 根治）：窗口结束移除属性，而非留 'false' 值污染 dataset
    root.removeAttribute('data-accent-anim')
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
