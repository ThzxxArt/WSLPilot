import { describe, it, expect } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import Sparkline from './Sparkline.vue'

function gradientId(w: VueWrapper): string {
  return w.get('linearGradient').attributes('id') ?? ''
}

describe('Sparkline gradient uid（实例级，禁 values 派生）', () => {
  it('同值多实例 gradient id 互不碰撞，fill 各自引用自己的 gradient', () => {
    const values = [1, 2, 3, 2]
    const a = mount(Sparkline, { props: { values } })
    const b = mount(Sparkline, { props: { values: [...values] } })
    const idA = gradientId(a)
    const idB = gradientId(b)
    expect(idA).toBeTruthy()
    expect(idA).not.toBe(idB)
    expect(a.get('path').attributes('fill')).toBe(`url(#${idA})`)
    expect(b.get('path').attributes('fill')).toBe(`url(#${idB})`)
  })

  it('id 不随 values 变化（实例级），path 真实随值变化', async () => {
    const w = mount(Sparkline, { props: { values: [1, 2, 3] } })
    const idBefore = gradientId(w)
    const areaBefore = w.get('path').attributes('d')
    await w.setProps({ values: [3, 2, 1] })
    expect(gradientId(w)).toBe(idBefore)
    expect(w.get('path').attributes('d')).not.toBe(areaBefore)
  })
})

describe('Sparkline 数值健壮性（review 0.1.2）', () => {
  // 模板中 area path 在前、折线 path 在后：数值断言须取折线（避免混入封口坐标）
  function lineD(w: VueWrapper): string {
    return w.findAll('path')[1]?.attributes('d') ?? ''
  }

  it('非有限值被过滤：path 不含 NaN/Infinity，坐标点数=有限值数', () => {
    const w = mount(Sparkline, {
      props: { values: [1, Number.NaN, 3, Number.POSITIVE_INFINITY, 2], width: 60, height: 20 },
    })
    const d = lineD(w)
    expect(d).not.toContain('NaN')
    expect(d).not.toContain('Infinity')
    expect(d.match(/[ML]/g)).toHaveLength(3)
    expect(d).toMatch(/^M[\d.]+,[\d.]+( L[\d.]+,[\d.]+)*$/)
  })

  it('全非有限值不产生非法 path d', () => {
    const w = mount(Sparkline, {
      props: { values: [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] },
    })
    const d = lineD(w)
    expect(d.length).toBeGreaterThan(0)
    expect(d).not.toContain('NaN')
    expect(d).not.toContain('Infinity')
  })

  it('恒定序列画中线（不再贴底边）', () => {
    const w = mount(Sparkline, { props: { values: [5, 5, 5], width: 80, height: 28 } })
    const points = lineD(w).split(' ')
    expect(points).toHaveLength(3)
    for (const p of points) {
      // 中线 = height / 2 = 14
      expect(p.split(',')[1]).toBe('14.0')
    }
  })
})
