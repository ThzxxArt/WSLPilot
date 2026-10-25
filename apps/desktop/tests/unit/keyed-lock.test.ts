import { describe, it, expect } from 'vitest'
import { KeyedLock } from '../../src/main/services/keyed-lock'

describe('KeyedLock（0.1.4 统一串行锁）', () => {
  it('同一 key 严格 FIFO 串行；不同 key 并发', async () => {
    const lock = new KeyedLock()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const p1 = lock.runExclusive('a', async () => {
      order.push('a1-start')
      await gate
      order.push('a1-end')
    })
    const p2 = lock.runExclusive('a', async () => {
      order.push('a2')
    })
    const p3 = lock.runExclusive('b', async () => {
      order.push('b')
    })
    await p3
    expect(order).toContain('b')
    expect(order).not.toContain('a2')
    release()
    await Promise.all([p1, p2])
    expect(order).toEqual(['a1-start', 'b', 'a1-end', 'a2'])
  })

  it('前序抛错不阻断后继', async () => {
    const lock = new KeyedLock()
    await expect(
      lock.runExclusive('a', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(lock.runExclusive('a', async () => 42)).resolves.toBe(42)
  })

  it('clear 后新任务可立即执行（dispose 语义）', async () => {
    const lock = new KeyedLock()
    lock.clear()
    await expect(lock.runExclusive('a', async () => 'ok')).resolves.toBe('ok')
  })
})
