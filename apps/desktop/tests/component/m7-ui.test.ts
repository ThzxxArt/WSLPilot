import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    // 无障碍收敛（review 0.1.2）：aria-busy 由容器统一承载，行节点不再重复播报
    expect(rows[0]!.attributes('aria-busy')).toBeUndefined()
    expect(rows[0]!.attributes('role')).toBeUndefined()
    // 末行短一截（文本骨架通用形态）
    expect(rows[2]!.attributes('style')).toContain('width: 60%')
    expect(rows[0]!.attributes('style')).toContain('width: 100%')
    await flushPromises()
  })

  it('单根结构：父组件透传 class/style 落根节点，无多根 extraneous attrs 告警（review 0.1.2）', () => {
    const Parent = defineComponent({
      components: { Skeleton },
      template: '<Skeleton class="probe" style="margin: 0px" :rows="2" />',
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const w = mount(Parent)
      const root = w.get('.skeleton-rows')
      expect(root.classes()).toContain('probe')
      expect(root.attributes('style')).toContain('margin')
      const warnings = warn.mock.calls.flat().join(' ')
      expect(warnings).not.toContain('Extraneous non-props attributes')
    } finally {
      warn.mockRestore()
    }
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
    vi.useRealTimers()
  })

  const Host = defineComponent({
    render: () => withDirectives(h('button', 'ok'), [[vRipple]]),
  })

  it('pointerdown 生成涟漪节点；animationend 后清理（可观测）', () => {
    const w = mount(Host, { attachTo: document.body })
    const btn = w.find('button')
    expect(btn.classes()).toContain('ripple-host')
    btn.element.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 5, clientY: 5, button: 0, bubbles: true }),
    )
    const wave = btn.element.querySelector('.ripple-wave')
    expect(wave).toBeTruthy()
    // 动画结束 → 移除节点（此前测试从未验证清理 — 假信心）
    wave!.dispatchEvent(new Event('animationend'))
    expect(btn.element.querySelector('.ripple-wave')).toBeNull()
    w.unmount()
  })

  it('动画事件未触发时 500ms 兜底清理（防孤儿节点）', () => {
    vi.useFakeTimers()
    const w = mount(Host, { attachTo: document.body })
    const btn = w.find('button')
    btn.element.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 0, bubbles: true }),
    )
    expect(btn.element.querySelector('.ripple-wave')).toBeTruthy()
    vi.advanceTimersByTime(500)
    expect(btn.element.querySelector('.ripple-wave')).toBeNull()
    w.unmount()
    vi.useRealTimers()
  })

  it('animationend 清理后撤销兜底定时器（不再多留 500ms 引用）（review 0.1.2）', () => {
    vi.useFakeTimers()
    try {
      const w = mount(Host, { attachTo: document.body })
      const btn = w.find('button')
      const baseline = vi.getTimerCount()
      btn.element.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: 5, clientY: 5, button: 0, bubbles: true }),
      )
      expect(vi.getTimerCount()).toBe(baseline + 1)
      btn.element.querySelector('.ripple-wave')!.dispatchEvent(new Event('animationend'))
      expect(btn.element.querySelector('.ripple-wave')).toBeNull()
      expect(vi.getTimerCount()).toBe(baseline)
      w.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reduced-motion 下不生成涟漪（降级）', () => {
    document.documentElement.dataset.reduceMotion = 'true'
    const w = mount(Host, { attachTo: document.body })
    const btn = w.find('button')
    btn.element.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 0, bubbles: true }),
    )
    expect(btn.element.querySelector('.ripple-wave')).toBeNull()
    w.unmount()
  })

  it('右键不触发涟漪', () => {
    const w = mount(Host, { attachTo: document.body })
    const btn = w.find('button')
    btn.element.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 1, clientY: 1, button: 2, bubbles: true }),
    )
    expect(btn.element.querySelector('.ripple-wave')).toBeNull()
    w.unmount()
  })

  it('卸载即摘除监听并清句柄（可观测的清理契约）', () => {
    const w = mount(Host, { attachTo: document.body })
    const btn = w.find('button')
    const el = btn.element as HTMLElement & { __rippleCleanup?: () => void }
    expect(typeof el.__rippleCleanup).toBe('function')
    const spy = vi.spyOn(el, 'removeEventListener')
    w.unmount()
    // 清理动作被真实执行（监听移除 + 句柄删除）
    expect(spy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(el.__rippleCleanup).toBeUndefined()
    // 卸载后事件不再生成波纹
    el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))
    expect(el.querySelector('.ripple-wave')).toBeNull()
  })
})
