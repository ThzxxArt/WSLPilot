/**
 * v-ripple 指令（设计书 §13.2：按钮点击涟漪扩散 140ms）。
 * 纯 DOM 操作，零依赖；reduced-motion 下自动跳过（不生成波纹节点）。
 */
import type { Directive, DirectiveBinding } from 'vue'

interface RippleHost extends HTMLElement {
  __rippleCleanup?: () => void
}

function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return true
  return (
    document.documentElement.dataset.reduceMotion === 'true' ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  )
}

function spawnRipple(host: HTMLElement, ev: PointerEvent): void {
  const rect = host.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height) * 2
  const wave = document.createElement('span')
  wave.className = 'ripple-wave'
  wave.style.width = `${size}px`
  wave.style.height = `${size}px`
  wave.style.left = `${ev.clientX - rect.left - size / 2}px`
  wave.style.top = `${ev.clientY - rect.top - size / 2}px`
  host.appendChild(wave)
  const remove = () => wave.remove()
  wave.addEventListener('animationend', remove)
  // 兜底：动画被跳过（reduced-motion 例外）时 500ms 后清节点，杜绝泄漏
  setTimeout(remove, 500)
}

function onPointerDown(this: RippleHost, ev: Event): void {
  if (prefersReducedMotion()) return
  if ((ev as PointerEvent).button !== undefined && (ev as PointerEvent).button !== 0) return
  spawnRipple(this, ev as PointerEvent)
}

export const vRipple: Directive<RippleHost, void> = {
  mounted(el: RippleHost, _binding: DirectiveBinding<void>) {
    el.classList.add('ripple-host')
    el.addEventListener('pointerdown', onPointerDown)
    el.__rippleCleanup = () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.classList.remove('ripple-host')
    }
  },
  unmounted(el: RippleHost) {
    el.__rippleCleanup?.()
    delete el.__rippleCleanup
  },
}

export default vRipple
