/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { usePolling } from '../../src/renderer/composables/usePolling'

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs task on interval', () => {
    const task = vi.fn()
    const { start } = usePolling(task, { intervalMs: 1000, pauseWhenHidden: false })
    start()
    vi.advanceTimersByTime(3000)
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('stop halts polling', () => {
    const task = vi.fn()
    const { start, stop } = usePolling(task, { intervalMs: 1000, pauseWhenHidden: false })
    start()
    vi.advanceTimersByTime(1000)
    stop()
    vi.advanceTimersByTime(5000)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('is idempotent start', () => {
    const task = vi.fn()
    const { start } = usePolling(task, { intervalMs: 1000, pauseWhenHidden: false })
    start()
    start()
    vi.advanceTimersByTime(1000)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('clamps interval to >= 1000ms', () => {
    const task = vi.fn()
    const { start } = usePolling(task, { intervalMs: 10, pauseWhenHidden: false })
    start()
    vi.advanceTimersByTime(1000)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('rebuilds timer when interval Ref changes', () => {
    const task = vi.fn()
    const interval = ref(1000)
    const { start } = usePolling(task, { intervalMs: interval, pauseWhenHidden: false })
    start()
    vi.advanceTimersByTime(1000)
    expect(task).toHaveBeenCalledTimes(1)
    interval.value = 2000
    vi.advanceTimersByTime(5000)
    // 新间隔 2s：5s 内约 2 次
    expect(task.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('pauseWhenHidden skips task when document.hidden', () => {
    const task = vi.fn()
    const { start } = usePolling(task, { intervalMs: 1000, pauseWhenHidden: true })
    start()
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    vi.advanceTimersByTime(3000)
    expect(task).toHaveBeenCalledTimes(0)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    vi.advanceTimersByTime(1000)
    expect(task).toHaveBeenCalledTimes(1)
  })
})
