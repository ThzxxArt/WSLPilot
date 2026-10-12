import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import StatusDot from '@ui/components/StatusDot.vue'
import Sparkline from '@ui/components/Sparkline.vue'
import MetricCard from '@ui/components/MetricCard.vue'
import ProgressRing from '@ui/components/ProgressRing.vue'
import DistroCard from '@ui/components/DistroCard.vue'
import { applyAccentToDom } from '@ui/index'
import { buildThemeOverrides } from '@ui/naive'
import { useReducedMotion } from '@ui/composables/useReducedMotion'
import { accentMaps, primitiveGradients, radius, semanticLight, textScale } from '@ui/tokens'
import type { DistroView } from '@wslpilot/shared'

function distro(over: Partial<DistroView> = {}): DistroView {
  return {
    name: 'Ubuntu-22.04',
    state: 'Running',
    version: 2,
    isDefault: false,
    meta: {
      name: 'Ubuntu-22.04',
      alias: '主力开发',
      tags: ['work'],
      color: '#E95420',
      icon: 'ubuntu',
      note: '',
      startupCwd: '~',
      pinned: false,
      quickActions: [],
    },
    ...over,
  }
}

describe('StatusDot', () => {
  it('renders running state with pulse class', () => {
    const w = mount(StatusDot, { props: { state: 'Running', size: 12 } })
    expect(w.classes()).toContain('status-dot')
    expect(w.classes()).toContain('pulsing')
    expect(w.attributes('aria-label')).toContain('Running')
  })

  it('does not pulse when stopped', () => {
    const w = mount(StatusDot, { props: { state: 'Stopped' } })
    expect(w.classes()).not.toContain('pulsing')
  })
})

describe('Sparkline', () => {
  it('renders path for values', () => {
    const w = mount(Sparkline, { props: { values: [1, 2, 3, 2, 5], width: 60, height: 20 } })
    expect(w.find('path').exists()).toBe(true)
    expect(w.find('path').attributes('d')).toContain('M')
  })

  it('renders placeholder when values empty', () => {
    const w = mount(Sparkline, { props: { values: [] } })
    expect(w.find('path').exists()).toBe(true)
  })
})

describe('MetricCard', () => {
  it('shows label and value', () => {
    const w = mount(MetricCard, {
      props: { label: '运行中', value: 3, hint: '共 5 个' },
    })
    expect(w.text()).toContain('运行中')
    expect(w.text()).toContain('3')
    expect(w.text()).toContain('共 5 个')
  })

  it('renders sparkline when history has points', () => {
    const w = mount(MetricCard, {
      props: { label: 'CPU', value: '10%', history: [1, 2, 3, 4] },
    })
    expect(w.findComponent(Sparkline).exists()).toBe(true)
  })

  it('pulse 脉冲点（离散计数卡）：有 pulse 有点、无 pulse 无点、不渲染趋势线', () => {
    const w = mount(MetricCard, {
      props: { label: '运行中', value: 1, hint: '共 2 个', pulse: true },
    })
    expect(w.find('.metric-pulse').exists()).toBe(true)
    expect(w.findComponent(Sparkline).exists()).toBe(false)
    const plain = mount(MetricCard, { props: { label: 'x', value: 1 } })
    expect(plain.find('.metric-pulse').exists()).toBe(false)
  })

  it('passes gradient stroke to sparkline', () => {
    const w = mount(MetricCard, {
      props: {
        label: 'x',
        value: 1,
        history: [1, 2, 3],
        gradient: '#123456',
      },
    })
    const spark = w.findComponent(Sparkline)
    expect(spark.props('stroke')).toBe('#123456')
  })

  it('animates numeric value updates and accepts string values', async () => {
    const w = mount(MetricCard, {
      props: { label: 'CPU', value: 10 },
    })
    await w.setProps({ value: 20 })
    // 字符串值直接显示
    await w.setProps({ value: '12.3G / 100G' })
    expect(w.text()).toContain('12.3G / 100G')
  })

  it('数字动画 rAF 真正推进到目标值（review M5）', async () => {
    const w = mount(MetricCard, { props: { label: 'x', value: 1 } })
    await w.setProps({ value: 5 })
    await new Promise((r) => setTimeout(r, 750))
    expect(w.text()).toContain('5')
  })

  it('应用内减弱动效时数值瞬时切换（review M5）', async () => {
    document.documentElement.dataset.reduceMotion = 'true'
    try {
      const w = mount(MetricCard, { props: { label: 'x', value: 1 } })
      await w.setProps({ value: 9 })
      await Promise.resolve()
      expect(w.text()).toContain('9')
    } finally {
      delete document.documentElement.dataset.reduceMotion
    }
  })

  it('字符串数字不触发数值动画（rAF 不被调度，直接展示）— review 0.1.2 审计修复假覆盖', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    try {
      const w = mount(MetricCard, { props: { label: 'CPU', value: 0 } })
      raf.mockClear()
      await w.setProps({ value: '42' })
      // 若实现把字符串数字送入动画，会调度 rAF → 此断言失败
      expect(raf).not.toHaveBeenCalled()
      expect(w.find('.metric-value').text()).toBe('42')
    } finally {
      raf.mockRestore()
    }
  })

  it('动画中途开启 reduced-motion：取消动画并立即落终值（review 0.1.2）', async () => {
    document.documentElement.dataset.reduceMotion = 'false'
    try {
      const w = mount(MetricCard, { props: { label: 'x', value: 0 } })
      await w.setProps({ value: 100 })
      // 真实计时推进 ~80ms：动画在途中（480ms 档），未到终值
      await new Promise((r) => setTimeout(r, 80))
      expect(w.text()).not.toContain('100')
      document.documentElement.dataset.reduceMotion = 'true'
      // MutationObserver 回调 + watcher flush
      await new Promise((r) => setTimeout(r, 20))
      await nextTick()
      expect(w.text()).toContain('100')
    } finally {
      delete document.documentElement.dataset.reduceMotion
    }
  })
})

describe('ProgressRing 尺寸守卫与渐变令牌（review 0.1.2）', () => {
  it('stroke ≥ size 时半径 clamp 到 0（不产出负 r）', () => {
    // stroke = size 的 1.2 倍：旧实现得 (20-24)/2 = -2，此用例在旧代码必失败（review 0.1.2 审计修复假覆盖）
    const w = mount(ProgressRing, { props: { percent: 50, size: 20, stroke: 24 } })
    const r = Number(w.get('circle.value').attributes('r'))
    expect(Number.isFinite(r)).toBe(true)
    expect(r).toBe(0)
    expect(w.get('circle.track').attributes('r')).toBe('0')
    // 进度文本仍正常
    expect(w.text()).toContain('50%')
  })

  it('默认渐变色停派生自 shared PRIMITIVE_GRADIENTS.aurora（非硬编码默认值）', () => {
    const w = mount(ProgressRing, { props: { percent: 10 } })
    const expected = primitiveGradients.aurora.match(/#[0-9a-f]{6}/gi) ?? []
    expect(expected.length).toBeGreaterThanOrEqual(2)
    const stops = w.findAll('linearGradient stop')
    expect(stops[0]!.attributes('stop-color')).toBe(expected[0])
    expect(stops[1]!.attributes('stop-color')).toBe(expected[1])
    // review 0.1.2 第二轮审计：不断言 props 默认值为空串（会拒绝「默认值 = 令牌常量」的
    // 等价实现，属过度断言）；上面的色值跟随断言已本质覆盖「渲染与令牌联动」。
  })
})

describe('theme-overrides 令牌化扩展（review 0.1.2）', () => {
  const o = buildThemeOverrides('aurora')

  it('common：pressed 由 ACCENT_MAPS hover 派生（不再复用 hover），字号/圆角引用令牌', () => {
    expect(o.common!.primaryColorHover).toBe(accentMaps.aurora.accentHover)
    expect(o.common!.primaryColorPressed).not.toBe(o.common!.primaryColorHover)
    expect(o.common!.primaryColorPressed).toMatch(/^#[0-9a-f]{6}$/i)
    expect(o.common!.fontSize).toBe(textScale.body.size)
    expect(o.Button!.borderRadiusMedium).toBe(radius.md)
  })

  it('Input/Select/Tag：边框/占位/主色与语义令牌一致', () => {
    expect(o.Input!.borderFocus).toContain(accentMaps.aurora.accent)
    expect(o.Input!.placeholderColor).toBe(semanticLight.textTertiary)
    expect(o.Input!.border).toContain(semanticLight.borderDefault)
    const selection = o.Select!.peers!.InternalSelection!
    expect(selection.borderFocus).toContain(accentMaps.aurora.accent)
    expect(selection.placeholderColor).toBe(semanticLight.textTertiary)
    expect(o.Tag!.borderRadius).toBe(radius.sm)
    expect(o.Tag!.color).toBe(semanticLight.bgSunken)
    expect(o.Tag!.textColor).toBe(semanticLight.textSecondary)
  })

  it('Dropdown/Tooltip/Message：浮层与提示色令牌化', () => {
    expect(o.Dropdown!.optionTextColorHover).toContain(accentMaps.aurora.accent)
    expect(o.Dropdown!.dividerColor).toBe(semanticLight.borderSubtle)
    expect(o.Tooltip!.textColor).toBe(semanticLight.textInverse)
    expect(o.Message!.textColor).toBe(semanticLight.textPrimary)
    expect(o.Message!.borderRadius).toBe(radius.md)
  })
})

describe('applyAccentToDom（review 0.1.2）', () => {
  it('切换窗口挂 data-accent-anim，结束后移除属性而非置 false', () => {
    vi.useFakeTimers()
    try {
      applyAccentToDom('ocean')
      const root = document.documentElement
      expect(root.getAttribute('data-accent-anim')).toBe('true')
      expect(root.dataset.accent).toBe('ocean')
      expect(root.style.getPropertyValue('--color-accent')).toBe(accentMaps.ocean.accent)
      vi.advanceTimersByTime(320)
      expect(root.hasAttribute('data-accent-anim')).toBe(false)
      expect(root.dataset.accentAnim).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useReducedMotion 挂载对账（review 0.1.2）', () => {
  it('setup 与 mounted 之间 DOM 变化在 onMounted 同步生效', async () => {
    const Probe = defineComponent({
      setup() {
        const { reduced } = useReducedMotion()
        return { reduced }
      },
      beforeMount() {
        // 模拟挂载间隙设置变更（setup 已读到旧值，onMounted 必须先 update 对账）
        document.documentElement.dataset.reduceMotion = 'true'
      },
      template: '<div class="probe">{{ reduced ? "reduced" : "normal" }}</div>',
    })
    try {
      const w = mount(Probe)
      await nextTick()
      expect(w.get('.probe').text()).toBe('reduced')
      w.unmount()
    } finally {
      delete document.documentElement.dataset.reduceMotion
    }
  })
})

describe('DistroCard', () => {
  it('renders name, alias, brand color and default tag', () => {
    const w = mount(DistroCard, {
      props: { distro: distro({ isDefault: true }) },
      global: { stubs: { NButton: false, NDropdown: true, NTag: true } },
    })
    expect(w.text()).toContain('主力开发')
    expect(w.text()).toContain('Ubuntu-22.04')
    expect(w.html()).toContain('#E95420')
    expect(w.text()).toContain('运行中')
    expect(w.text()).toContain('默认')
  })

  it('shows start button when stopped and terminate when running', async () => {
    const stopped = mount(DistroCard, {
      props: { distro: distro({ state: 'Stopped' }) },
      global: { stubs: { NButton: true, NDropdown: true, NTag: true } },
    })
    expect(stopped.text()).toContain('启动')

    const running = mount(DistroCard, {
      props: { distro: distro({ state: 'Running' }) },
      global: { stubs: { NButton: true, NDropdown: true, NTag: true } },
    })
    expect(running.text()).toContain('停止')
  })

  it('按钮语义统一：启动=蓝（primary 无品牌色覆盖）、停止=红（error）；终端仅运行中可点', () => {
    const stopped = mount(DistroCard, {
      props: { distro: distro({ state: 'Stopped' }) },
      global: { stubs: { NButton: false, NDropdown: true, NTag: true } },
    })
    const startBtn = stopped.findAll('button').find((b) => b.text().trim() === '启动')!
    expect(startBtn.classes().some((c) => c.includes('primary'))).toBe(true)
    // 品牌色不再覆盖按钮底色（review 颜色不一致根治）
    expect(startBtn.attributes('style') ?? '').not.toContain('background')
    const termStopped = stopped.findAll('button').find((b) => b.text().trim() === '终端')!
    expect(termStopped.attributes('disabled')).toBeDefined()

    const running = mount(DistroCard, {
      props: { distro: distro({ state: 'Running' }) },
      global: { stubs: { NButton: false, NDropdown: true, NTag: true } },
    })
    const stopBtn = running.findAll('button').find((b) => b.text().trim() === '停止')!
    expect(stopBtn.classes().some((c) => c.includes('error'))).toBe(true)
    const termRunning = running.findAll('button').find((b) => b.text().trim() === '终端')!
    expect(termRunning.attributes('disabled')).toBeUndefined()
  })

  it('emits start / terminate with distro name', async () => {
    const w = mount(DistroCard, {
      props: { distro: distro({ state: 'Stopped' }) },
      global: {
        stubs: {
          NButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          NDropdown: true,
          NTag: true,
        },
      },
    })
    const btns = w.findAll('button')
    await btns[0]!.trigger('click')
    expect(w.emitted('start')?.[0]).toEqual(['Ubuntu-22.04'])
  })

  it('running 状态点停止按钮 emit terminate', async () => {
    const w = mount(DistroCard, {
      props: { distro: distro({ state: 'Running' }) },
      global: {
        stubs: {
          NButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          NDropdown: true,
          NTag: true,
        },
      },
    })
    const btns = w.findAll('button')
    await btns[0]!.trigger('click')
    expect(w.emitted('terminate')?.[0]).toEqual(['Ubuntu-22.04'])
  })

  it('more 菜单分发 setDefault / terminal / more 事件', async () => {
    const { NDropdown } = await import('naive-ui')
    const w = mount(DistroCard, {
      props: { distro: distro() },
      global: {
        stubs: { NButton: true, NTag: true },
      },
    })
    const dd = w.findComponent(NDropdown)
    await dd.vm.$emit('select', 'setDefault')
    expect(w.emitted('setDefault')?.[0]).toEqual(['Ubuntu-22.04'])
    await dd.vm.$emit('select', 'terminal')
    expect(w.emitted('openTerminal')?.[0]).toEqual(['Ubuntu-22.04'])
    await dd.vm.$emit('select', 'more')
    expect(w.emitted('more')?.[0]).toEqual(['Ubuntu-22.04'])
    await dd.vm.$emit('select', 'unknown')
    expect(w.emitted('more')).toHaveLength(1)
  })

  it('shows Chinese state for Unknown', () => {
    const w = mount(DistroCard, {
      props: { distro: distro({ state: 'Unknown' }) },
      global: { stubs: { NButton: true, NDropdown: true, NTag: true } },
    })
    expect(w.text()).toContain('未知')
    expect(w.text()).not.toContain('Unknown')
  })

  it('falls back to distro name when no alias', () => {
    const w = mount(DistroCard, {
      props: {
        distro: distro({
          meta: { ...distro().meta!, alias: '' },
        }),
      },
      global: { stubs: { NButton: true, NDropdown: true, NTag: true } },
    })
    expect(w.text()).toContain('Ubuntu-22.04')
  })
})
