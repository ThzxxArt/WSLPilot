import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, defineStore, setActivePinia } from 'pinia'

// 纯逻辑组件测试（不依赖 Naive UI 运行时）
// UI 组件测试请放到 apps/desktop/tests/component/

const useInfraProbeStore = defineStore('infra-probe', {
  state: () => ({ count: 0 }),
  actions: {
    inc() {
      this.count += 1
    },
  },
})

describe('测试基础设施', () => {
  it('happy-dom 环境可用', () => {
    const el = document.createElement('div')
    el.textContent = 'ok'
    expect(el.textContent).toBe('ok')
  })

  it('Pinia 可初始化且 store 可挂载读写', () => {
    setActivePinia(createPinia())
    const store = useInfraProbeStore()
    expect(store.count).toBe(0)
    store.inc()
    expect(store.count).toBe(1)
    // 新 pinia 实例状态独立（store 真挂到 pinia 上，而非本地对象）
    setActivePinia(createPinia())
    expect(useInfraProbeStore().count).toBe(0)
  })

  it('Vue mount 可用', () => {
    const wrapper = mount({
      template: '<div class="probe">{{ msg }}</div>',
      data: () => ({ msg: 'hello' }),
    })
    expect(wrapper.find('.probe').text()).toBe('hello')
  })
})
