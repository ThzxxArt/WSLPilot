import { onUnmounted, ref, watch, type Ref } from 'vue'

/**
 * 轮询节流 — 设计书 §19：
 * - intervalMs 可动态变化（响应 settings.pollIntervalMs）
 * - 窗口失焦暂停
 */
export function usePolling(
  task: () => void | Promise<void>,
  options: { intervalMs?: number | Ref<number>; pauseWhenHidden?: boolean } = {},
): { active: Ref<boolean>; stop: () => void; start: () => void } {
  const pauseWhenHidden = options.pauseWhenHidden ?? true
  const active = ref(false)
  let timer: number | null = null

  const resolveInterval = () => {
    const v = options.intervalMs
    const n = typeof v === 'number' ? v : (v?.value ?? 5000)
    return Math.max(1000, n)
  }

  const tick = () => {
    if (pauseWhenHidden && document.hidden) return
    void task()
  }

  const start = () => {
    if (timer !== null) return
    active.value = true
    timer = window.setInterval(tick, resolveInterval())
  }

  const stop = () => {
    active.value = false
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  const restart = () => {
    if (!active.value) return
    stop()
    start()
  }

  // intervalMs 变化时重建定时器
  if (typeof options.intervalMs === 'object' && options.intervalMs !== null) {
    watch(options.intervalMs, restart)
  }

  onUnmounted(stop)

  return { active, start, stop }
}
