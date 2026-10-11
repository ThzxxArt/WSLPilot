import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * renderer/router：路由表完整性 + afterEach 按 meta.title 设置 document.title
 * （meta.title 是窗口标题的真实消费点，此前为幽灵字段 — review 根治）。
 * vue-router 的 afterGuards 不对外暴露、hash 导航在 happy-dom 挂起：
 * 因此捕获 router/index.ts 对 afterEach 的注册回调并直接驱动它 ——
 * 被测对象就是 router/index.ts 的真实处理器，vue-router 本身不在被测范围。
 */

const captured: Array<(to: unknown, from: unknown) => void> = []

vi.mock('vue-router', () => ({
  createWebHashHistory: () => ({}),
  createRouter: (opts: unknown) => ({
    options: opts,
    afterEach(fn: (to: unknown, from: unknown) => void) {
      captured.push(fn)
    },
    getRoutes() {
      return (opts as { routes: Array<Record<string, unknown>> }).routes.map((r) => ({
        ...r,
        meta: r.meta ?? {},
      }))
    },
  }),
}))

const { router } = await import('../../src/renderer/router')

beforeEach(() => {
  document.title = ''
})

describe('router 路由表与标题', () => {
  it('路由表含全部七页且 meta.title 齐备', () => {
    const routes = (router as unknown as { options: { routes: Array<Record<string, unknown>> } })
      .options.routes
    const names = routes.map((r) => r.name)
    for (const n of [
      'dashboard',
      'distros',
      'terminal',
      'network',
      'backup',
      'devices',
      'settings',
    ]) {
      expect(names, `缺少路由 ${n}`).toContain(n)
    }
    for (const r of routes.filter((r) => !r.redirect)) {
      expect(
        typeof (r.meta as Record<string, unknown>).title,
        `路由 ${String(r.name)} 缺 meta.title`,
      ).toBe('string')
    }
    // 根路径重定向到驾驶舱
    expect(routes.find((r) => r.path === '/')?.redirect).toBe('/dashboard')
  })

  it('afterEach 真实处理器：有 title → `标题 · WSLPilot`；无 title → 裸 WSLPilot', () => {
    expect(captured, 'router/index.ts 应注册 afterEach').toHaveLength(1)
    const after = captured[0]!

    after({ meta: { title: '设置' } }, {})
    expect(document.title).toBe('设置 · WSLPilot')

    after({ meta: { title: '' } }, {})
    expect(document.title).toBe('WSLPilot')

    after({ meta: {} }, {})
    expect(document.title).toBe('WSLPilot')
  })
})
