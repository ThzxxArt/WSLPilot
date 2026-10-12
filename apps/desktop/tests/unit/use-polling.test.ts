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

  it('rebuilds timer when interval Ref changes', async () => {
    const task = vi.fn()
    const interval = ref(1000)
    const { start } = usePolling(task, { intervalMs: interval, pauseWhenHidden: false })
    start()
    vi.advanceTimersByTime(1000)
    expect(task).toHaveBeenCalledTimes(1)
    interval.value = 2000
    // watch 为 pre-flush：先让重建生效，再推进时钟（否则旧 1s 计时器继续发）
    await Promise.resolve()
    vi.advanceTimersByTime(5000)
    // 旧间隔 1 次 + 新间隔（2s）× 5s 内 2 次 = 精确 3 次（注释与断言一致 — review）
    expect(task.mock.calls.length).toBe(3)
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

  it('task reject 被 catch 落地（不产生 unhandled rejection — review 0.1.2）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const task = vi.fn(() => Promise.reject(new Error('poll boom')))
    const { start, stop } = usePolling(task, { intervalMs: 1000, pauseWhenHidden: false })
    start()
    vi.advanceTimersByTime(1000)
    await Promise.resolve()
    expect(task).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('轮询任务失败'), expect.any(Error))
    stop()
    errSpy.mockRestore()
  })

  it('task 同步异常也被捕获', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const task = vi.fn(() => {
      throw new Error('sync boom')
    })
    const { start, stop } = usePolling(task, { intervalMs: 1000, pauseWhenHidden: false })
    start()
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('轮询任务异常'), expect.any(Error))
    stop()
    errSpy.mockRestore()
  })

  it('visibilitychange 真正暂停/恢复定时器（不做空转 — review 0.1.2）', () => {
    const task = vi.fn()
    const { start, stop } = usePolling(task, { intervalMs: 1000, pauseWhenHidden: true })
    start()
    vi.advanceTimersByTime(1000)
    expect(task).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(5000)
    expect(task).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    // 恢复可见：立即补一次采样
    expect(task).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(2000)
    expect(task).toHaveBeenCalledTimes(4)
    stop()
  })
})
