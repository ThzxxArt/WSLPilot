import { describe, it, expect } from 'vitest'
import { flushPromises } from '@vue/test-utils'

/**
 * 路由表真实导航（0.1.3 覆盖补录）：不 mock vue-router——
 * 验证 title afterEach（meta.title 唯一消费点）与未知路径重定向（review 0.1.2 白屏根治）。
 */
describe('renderer 路由表', () => {
  it('导航设置窗口标题；未知路径重定向驾驶舱且标题复位', async () => {
    const { router } = await import('../../src/renderer/router/index')
    await router.push('/settings')
    await router.isReady()
    await flushPromises()
    expect(document.title).toBe('设置 · WSLPilot')

    await router.push('/no-such-page')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/dashboard')
    expect(document.title).toBe('驾驶舱 · WSLPilot')

    // 根路径重定向
    await router.push('/')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/dashboard')
  }, 60_000) // 首次导航触发路由懒加载（SettingsView → naive/@wslpilot/ui 首次编译），放宽到 60s
})
