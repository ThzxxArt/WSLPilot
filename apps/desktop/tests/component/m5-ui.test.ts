import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CodeEditor from '@ui/components/CodeEditor.vue'
import Kbd from '@ui/components/Kbd.vue'
import * as uiComponents from '@ui/components'

describe('CodeEditor', () => {
  it('渲染行号与内容', () => {
    const w = mount(CodeEditor, { props: { modelValue: 'a\nb\nc' } })
    expect(w.findAll('.gutter-line')).toHaveLength(3)
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('a\nb\nc')
  })

  it('输入触发 update:modelValue', async () => {
    const w = mount(CodeEditor, { props: { modelValue: '' } })
    const ta = w.find('textarea')
    await ta.setValue('hello')
    expect(w.emitted('update:modelValue')![0]).toEqual(['hello'])
  })

  it('modelValue 变化同步到编辑器', async () => {
    const w = mount(CodeEditor, { props: { modelValue: 'x' } })
    await w.setProps({ modelValue: 'y' })
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toBe('y')
  })

  it('readonly 时不触发输入副作用', async () => {
    const w = mount(CodeEditor, { props: { modelValue: 'x', readonly: true } })
    expect(w.find('textarea').attributes('readonly')).toBeDefined()
    await w.find('textarea').trigger('keydown', { key: 'Tab' })
    // readonly 下 Tab 不产生编辑
    expect(w.emitted('update:modelValue') ?? []).toHaveLength(0)
  })

  it('Tab 插入两个空格', async () => {
    const w = mount(CodeEditor, { props: { modelValue: '' } })
    const ta = w.find('textarea')
    await ta.trigger('keydown', { key: 'Tab' })
    const emitted = w.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toBe('  ')
  })

  it('Shift+Tab 反缩进', async () => {
    const w = mount(CodeEditor, { props: { modelValue: '  indented' } })
    const ta = w.find('textarea')
    await ta.trigger('keydown', { key: 'Tab', shiftKey: true })
    const emitted = w.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toBe('indented')
  })

  it('隐藏行号时可关闭', () => {
    const w = mount(CodeEditor, { props: { modelValue: 'a', showLineNumbers: false } })
    expect(w.find('.gutter').exists()).toBe(false)
  })

  it('滚动同步行号槽位移', async () => {
    const w = mount(CodeEditor, { props: { modelValue: 'a\nb' } })
    const ta = w.find('textarea').element as HTMLTextAreaElement
    Object.defineProperty(ta, 'scrollTop', { value: 40, configurable: true })
    await w.find('textarea').trigger('scroll')
    expect(w.find('.gutter-inner').attributes('style')).toContain('translateY(-40px)')
  })
})

describe('Kbd', () => {
  it('渲染按键序列', () => {
    const w = mount(Kbd, { props: { keys: ['Ctrl', 'K'] } })
    expect(w.findAll('kbd')).toHaveLength(2)
    expect(w.text()).toContain('Ctrl')
    expect(w.text()).toContain('K')
    expect(w.attributes('aria-label')).toBe('Ctrl + K')
  })

  it('渲染单键 text', () => {
    const w = mount(Kbd, { props: { text: 'Esc' } })
    expect(w.findAll('kbd')).toHaveLength(1)
    expect(w.text()).toBe('Esc')
  })
})

describe('M5 UI 组件注册', () => {
  it('index 导出 CodeEditor / Kbd', () => {
    expect(uiComponents.CodeEditor).toBeTruthy()
    expect(uiComponents.Kbd).toBeTruthy()
  })
})
