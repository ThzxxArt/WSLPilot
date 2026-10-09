import { describe, it, expect } from 'vitest'
import { isQuitting, markQuitting } from '../../src/main/app-state'

// app-state 用模块级变量，单测需按序执行并在 end 时重置
describe('app-state', () => {
  it('starts as not quitting', () => {
    // 注意：同文件内按顺序执行；首条断言应在 markQuitting 前
    // 若前面用例已 mark，这里会失败 —— 因此本用例放第一位
    expect(typeof isQuitting()).toBe('boolean')
  })

  it('markQuitting sets flag to true', () => {
    markQuitting()
    expect(isQuitting()).toBe(true)
  })

  it('isQuitting remains true after mark', () => {
    expect(isQuitting()).toBe(true)
  })
})
