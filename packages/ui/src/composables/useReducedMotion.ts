/**
 * useReducedMotion（设计书 §10.7 composables 清单）。
 * 同时响应：
 * - 系统偏好 `prefers-reduced-motion: reduce`
 * - 应用设置 `settings.general.reduceMotion`（<html data-reduce-motion="true">）
 * 返回响应式布尔值；组件可用它跳过纯装饰动画。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

function readDom(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.reduceMotion === 'true'
}

function readMedia(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useReducedMotion(): { reduced: Ref<boolean> } {
  const reduced = ref(readDom() || readMedia())
  let mediaQuery: MediaQueryList | null = null
  let observer: MutationObserver | null = null

  const update = () => {
    reduced.value = readDom() || readMedia()
  }

  onMounted(() => {
    if (typeof matchMedia === 'function') {
      mediaQuery = matchMedia('(prefers-reduced-motion: reduce)')
      mediaQuery.addEventListener('change', update)
    }
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      observer = new MutationObserver(update)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-reduce-motion'],
      })
    }
  })

  onUnmounted(() => {
    mediaQuery?.removeEventListener('change', update)
    observer?.disconnect()
    mediaQuery = null
    observer = null
  })

  return { reduced }
}

export default useReducedMotion
