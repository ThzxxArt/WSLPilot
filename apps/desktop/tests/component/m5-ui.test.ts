import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import CodeEditor from '@ui/components/CodeEditor.vue'
import Kbd from '@ui/components/Kbd.vue'
import EmptyState from '@ui/components/EmptyState.vue'
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

  it('多行选区 Tab：每行行首加两空格，空行跳过，选区恢复覆盖块（review 0.1.2）', async () => {
    const w = mount(CodeEditor, { props: { modelValue: 'a\n\nb' } })
    const ta = w.find('textarea').element as HTMLTextAreaElement
    ta.selectionStart = 0
    ta.selectionEnd = ta.value.length
    await w.find('textarea').trigger('keydown', { key: 'Tab' })
    const out = '  a\n\n  b'
    expect(w.emitted('update:modelValue')![0]![0]).toBe(out)
    // rAF 恢复选区：多行时覆盖整个变换后的块
    await vi.waitFor(() => {
      expect(ta.selectionStart).toBe(0)
      expect(ta.selectionEnd).toBe(out.length)
    })
  })

  it('多行选区 Shift+Tab：每行行首去最多两空格，无缩进不动（review 0.1.2）', async () => {
    const w = mount(CodeEditor, { props: { modelValue: '  a\n b\nc' } })
    const ta = w.find('textarea').element as HTMLTextAreaElement
    ta.selectionStart = 0
    ta.selectionEnd = ta.value.length
    await w.find('textarea').trigger('keydown', { key: 'Tab', shiftKey: true })
    const out = 'a\nb\nc'
    expect(w.emitted('update:modelValue')![0]![0]).toBe(out)
    await vi.waitFor(() => {
      expect(ta.selectionStart).toBe(0)
      expect(ta.selectionEnd).toBe(out.length)
    })
  })

  it('多行选区只变换覆盖块，块外文本不动', async () => {
    const w = mount(CodeEditor, { props: { modelValue: 'keep\nx\ny\ntail' } })
    const ta = w.find('textarea').element as HTMLTextAreaElement
    // 选区从 'x' 行首跨到 'y'（不含 tail 行）
    ta.selectionStart = 'keep\n'.length
    ta.selectionEnd = 'keep\nx\ny'.length
    await w.find('textarea').trigger('keydown', { key: 'Tab' })
    expect(w.emitted('update:modelValue')![0]![0]).toBe('keep\n  x\n  y\ntail')
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

  it('空输入不渲染空 kbd/空壳（review 0.1.2）', () => {
    const empty = mount(Kbd)
    expect(empty.findAll('kbd')).toHaveLength(0)
    expect(empty.find('.kbd').exists()).toBe(false)
    const blank = mount(Kbd, { props: { keys: ['', '  '] } })
    expect(blank.findAll('kbd')).toHaveLength(0)
    expect(blank.find('.kbd').exists()).toBe(false)
  })
})

describe('EmptyState', () => {
  it('渲染说明与插画', () => {
    const w = mount(EmptyState, {
      props: { description: '还没有发行版', illustration: '🐧' },
    })
    expect(w.text()).toContain('还没有发行版')
    expect(w.find('.illustration').text()).toBe('🐧')
    expect(w.attributes('role')).toBe('status')
  })

  it('默认文案与尺寸变体', () => {
    const w = mount(EmptyState)
    expect(w.text()).toContain('暂无数据')
    expect(w.find('.illustration').exists()).toBe(false)
    const big = mount(EmptyState, { props: { size: 'large', illustration: 'x' } })
    expect(big.classes()).toContain('size-large')
  })

  it('默认插槽渲染主 CTA', () => {
    const w = mount(EmptyState, {
      props: { description: '空' },
      slots: { default: '<button class="cta">去安装</button>' },
    })
    expect(w.find('.action .cta').exists()).toBe(true)
  })
})

describe('M5 UI 组件注册', () => {
  it('index 导出 CodeEditor / Kbd / EmptyState', () => {
    expect(uiComponents.CodeEditor).toBeTruthy()
    expect(uiComponents.Kbd).toBeTruthy()
    expect(uiComponents.EmptyState).toBeTruthy()
  })
})
