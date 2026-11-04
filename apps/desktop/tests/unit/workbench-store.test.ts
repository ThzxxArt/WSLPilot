import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkbenchStore } from '../../src/renderer/stores/workbench'

beforeEach(() => setActivePinia(createPinia()))

describe('useWorkbenchStore', () => {
  it('专注模式：开启时收起工具栏，退出恢复', () => {
    const s = useWorkbenchStore()
    s.toggleToolbar()
    expect(s.toolbarOpen).toBe(true)
    s.toggleFocus()
    expect(s.focusMode).toBe(true)
    expect(s.toolbarOpen).toBe(false)
    s.exitFocus()
    expect(s.focusMode).toBe(false)
  })

  it('会话侧栏与工具栏独立切换', () => {
    const s = useWorkbenchStore()
    s.toggleSessionRail()
    expect(s.sessionRailOpen).toBe(true)
    s.toggleToolbar()
    expect(s.toolbarOpen).toBe(true)
    s.closeToolbar()
    expect(s.toolbarOpen).toBe(false)
    expect(s.sessionRailOpen).toBe(true)
  })
})

describe('useWorkbenchStore 分支', () => {
  it('专注模式再次 toggle（true→false）不隐藏工具栏', () => {
    const s = useWorkbenchStore()
    s.toggleFocus()
    s.toggleToolbar()
    s.toggleFocus()
    expect(s.focusMode).toBe(false)
    expect(s.toolbarOpen).toBe(true)
  })
})
