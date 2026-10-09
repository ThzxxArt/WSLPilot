import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * app-state 用模块级变量 —— 每例 vi.resetModules 后动态 import，
 * 互不依赖执行顺序（review C3：顺序依赖 + 恒真断言根治）。
 */
describe('app-state', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('starts as not quitting', async () => {
    const { isQuitting } = await import('../../src/main/app-state')
    expect(isQuitting()).toBe(false)
  })

  it('markQuitting sets flag to true', async () => {
    const { isQuitting, markQuitting } = await import('../../src/main/app-state')
    expect(isQuitting()).toBe(false)
    markQuitting()
    expect(isQuitting()).toBe(true)
  })

  it('flag persists until module reset（退出决策依赖其粘性）', async () => {
    const first = await import('../../src/main/app-state')
    first.markQuitting()
    const { isQuitting: again } = await import('../../src/main/app-state')
    expect(again()).toBe(true)
  })

  it('模块重置后回到 false（隔离验证）', async () => {
    const first = await import('../../src/main/app-state')
    first.markQuitting()
    vi.resetModules()
    const second = await import('../../src/main/app-state')
    expect(second.isQuitting()).toBe(false)
  })
})
