import { onUnmounted, ref, watch, type Ref } from 'vue'
import { DEFAULT_POLL_INTERVAL_MS } from '@wslpilot/shared'

/**
 * 轮询节流 — 设计书 §19：
 * - intervalMs 可动态变化（响应 settings.pollIntervalMs）
 * - 窗口隐藏时真正暂停定时器（visibilitychange 恢复），不做「定时器空转 + 回调里判 hidden」
 *
 * review 0.1.2 根治：
 * 1) task 的同步异常与异步 reject 全部 catch 落地，不再产生 unhandled rejection；
 * 2) pauseWhenHidden 改为真正 clearInterval/重建，隐藏期间不再空转；
 *    保留 tick 内的 hidden 守卫作为兜底（事件未派发的边缘场景）。
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
    const n = typeof v === 'number' ? v : (v?.value ?? DEFAULT_POLL_INTERVAL_MS)
    return Math.max(1000, n)
  }

  const runTask = () => {
    if (pauseWhenHidden && document.hidden) return
    try {
      const result = task()
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch((e: unknown) => {
          console.error('[WSLPilot] 轮询任务失败:', e)
        })
      }
    } catch (e) {
      console.error('[WSLPilot] 轮询任务异常:', e)
    }
  }

  const clearTimer = () => {
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
  }

  const schedule = () => {
    if (timer !== null) return
    if (pauseWhenHidden && typeof document !== 'undefined' && document.hidden) return
    timer = window.setInterval(runTask, resolveInterval())
  }

  const start = () => {
    if (active.value) return
    active.value = true
    schedule()
  }

  const stop = () => {
    active.value = false
    clearTimer()
  }

  const restart = () => {
    if (!active.value) return
    clearTimer()
    schedule()
  }

  const onVisibilityChange = () => {
    if (!pauseWhenHidden) return
    if (document.hidden) {
      clearTimer()
    } else if (active.value && timer === null) {
      // 恢复可见：立即补一次采样，随后重建定时器
      runTask()
      schedule()
    }
  }

  if (pauseWhenHidden && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  // intervalMs 变化时重建定时器
  if (typeof options.intervalMs === 'object' && options.intervalMs !== null) {
    watch(options.intervalMs, restart)
  }

  onUnmounted(() => {
    stop()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  })

  return { active, start, stop }
}
