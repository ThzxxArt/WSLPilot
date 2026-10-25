/**
 * 串行锁（0.1.4）— TaskRunner 与直接操作共用的唯一实现。
 *
 * 语义：
 * - 同一 key 的任务严格串行（FIFO）
 * - 不同 key 并发
 * - `runExclusive` 的异常不影响后继（调用方自行处理）
 * - `clear` 只清空队尾索引，不强制取消已在执行的任务（dispose 由 TaskRunner 负责结算）
 */
export class KeyedLock {
  private tails = new Map<string, Promise<void>>()

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = prev.then(() => gate)
    this.tails.set(key, tail)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }

  /** 是否有任务正在执行该 key（不含排队） */
  isActive(key: string): boolean {
    return this.tails.has(key)
  }

  clear(): void {
    this.tails.clear()
  }
}
