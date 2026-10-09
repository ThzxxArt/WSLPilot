import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// 纯逻辑组件测试（不依赖 Naive UI 运行时）
// UI 组件测试请放到 apps/desktop/tests/component/

describe('测试基础设施', () => {
  it('happy-dom 环境可用', () => {
    const el = document.createElement('div')
    el.textContent = 'ok'
    expect(el.textContent).toBe('ok')
  })

  it('Pinia 可初始化', () => {
    setActivePinia(createPinia())
    expect(true).toBe(true)
  })

  it('Vue mount 可用', () => {
    const wrapper = mount({
      template: '<div class="probe">{{ msg }}</div>',
      data: () => ({ msg: 'hello' }),
    })
    expect(wrapper.find('.probe').text()).toBe('hello')
  })
})
