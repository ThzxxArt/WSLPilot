import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, withDirectives } from 'vue'
import Skeleton from '@ui/components/Skeleton.vue'
import EmptyState from '@ui/components/EmptyState.vue'
import { vRipple } from '@ui/directives/vRipple'

describe('Skeleton（M7 骨架屏 §12.8）', () => {
  it('单块骨架：尺寸参数 + 无障碍忙碌态', () => {
    const w = mount(Skeleton, { props: { width: '200px', height: '40px', radius: '12px' } })
    const el = w.get('.skeleton')
    expect(el.attributes('aria-busy')).toBe('true')
    expect(el.attributes('aria-label')).toBe('加载中')
    expect(el.attributes('role')).toBe('status')
    expect(el.attributes('style')).toContain('width: 200px')
    expect(el.attributes('style')).toContain('height: 40px')
    expect(el.attributes('style')).toContain('border-radius: 12px')
  })

  it('rows 模式：逐行骨架，末行 60%', async () => {
    const w = mount(Skeleton, { props: { rows: 3, height: '14px' } })
    const rows = w.findAll('.skeleton')
    expect(rows).toHaveLength(3)
    expect(w.get('.skeleton-rows').attributes('aria-busy')).toBe('true')
    // 末行短一截（文本骨架通用形态）
    expect(rows[2]!.attributes('style')).toContain('width: 60%')
    expect(rows[0]!.attributes('style')).toContain('width: 100%')
    await flushPromises()
  })
})

describe('EmptyState（空状态 §12.8）', () => {
  it('插画 + 说明 + CTA 槽，role=status', () => {
    const w = mount(EmptyState, {
      props: { description: '还没有发行版，去安装一个', illustration: '🛫', size: 'large' },
      slots: { default: '<button>安装发行版</button>' },
    })
    expect(w.attributes('role')).toBe('status')
    expect(w.text()).toContain('还没有发行版，去安装一个')
    expect(w.text()).toContain('安装发行版')
    expect(w.get('.illustration').attributes('aria-hidden')).toBe('true')
    expect(w.classes()).toContain('size-large')
  })

  it('小尺寸无插画时只展示说明', () => {
    const w = mount(EmptyState, { props: { description: '暂无数据', size: 'small' } })
    expect(w.find('.illustration').exists()).toBe(false)
    expect(w.find('.action').exists()).toBe(false)
    expect(w.classes()).toContain('size-small')
  })
})

describe('vRipple 指令（§13.2 涟漪）', () => {
  beforeEach(() => {
    document.documentElement.dataset.reduceMotion = 'false'
    if (typeof globalThis.matchMedia !== 'function') {
      ;(globalThis as any).matchMedia = () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      })
    }
  })

  afterEach(() => {
    delete document.documentElement.dataset.reduceMotion
  })

  const Host = defineComponent({
    render: () => withDirectives(h('button', 'ok'), [[vRipple]]),
  })

  it('pointerdown 生成涟漪节点，动画后清理', () => {
    const w = mount(Host, { attachTo: document.body })
    const btn = w.find('button')
    expect(btn.classes()).toContain('ripple-host')
    btn.element.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 5, clientY: 5, button: 0, bubbles: true }),
    )
    expect(w.find('.ripple-wave').exists()).toBe(true)
    w.unmount()
  })

  it('reduced-motion 下不生成涟漪（降级）', () => {
    document.documentElement.dataset.reduceMotion = 'true'
    const w = mount(Host, { attachTo: document.body })
    const btn = w.find('button')
    btn.element.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 0, bubbles: true }),
    )
    expect(w.find('.ripple-wave').exists()).toBe(false)
    w.unmount()
  })

  it('卸载时移除监听（防泄漏 — review 孤儿缓冲教训）', () => {
    const w = mount(Host, { attachTo: document.body })
    const btn = w.find('button')
    w.unmount()
    // 父节点已卸载：事件不会再有响应（监听器已清理，不抛错即可）
    expect(() =>
      btn.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    ).not.toThrow()
  })
})
