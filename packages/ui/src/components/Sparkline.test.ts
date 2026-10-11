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
