import { onUnmounted, ref, type Ref } from 'vue'

/**
 * 轮询节流 — 设计书 §19：
 * - 默认 intervalMs（5000）
 * - 窗口失焦暂停
 */
export function usePolling(
  task: () => void | Promise<void>,
  options: { intervalMs?: number; pauseWhenHidden?: boolean } = {},
): { active: Ref<boolean>; stop: () => void; start: () => void } {
  const intervalMs = options.intervalMs ?? 5000
  const pauseWhenHidden = options.pauseWhenHidden ?? true
  const active = ref(false)
  let timer: number | null = null

  const tick = () => {
    if (pauseWhenHidden && document.hidden) return
    void task()
  }

  const start = () => {
    if (timer !== null) return
    active.value = true
    timer = window.setInterval(tick, intervalMs)
  }

  const stop = () => {
    active.value = false
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  onUnmounted(stop)

  return { active, start, stop }
}
