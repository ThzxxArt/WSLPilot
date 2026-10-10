import { describe, it, expect } from 'vitest'
import {
  TERMINAL_LIGHT_THEME,
  TERMINAL_CONTRAST_THEME,
  DEFAULT_TERMINAL_PREFS,
  resolveTerminalTheme,
} from '../../src/renderer/features/terminal/theme'
import { defaultConfig } from '@shared/config-schema'

describe('terminal theme', () => {
  it('light theme has readable dark-on-light colors', () => {
    expect(TERMINAL_LIGHT_THEME.background).toBe('#FBFCFE')
    expect(TERMINAL_LIGHT_THEME.foreground).toBe('#1E293B')
    expect(TERMINAL_LIGHT_THEME.cursor).toBeTruthy()
    // 16 色齐全
    expect(TERMINAL_LIGHT_THEME.black).toBeTruthy()
    expect(TERMINAL_LIGHT_THEME.brightWhite).toBeTruthy()
  })

  it('contrast theme keeps dark-on-light readability', () => {
    expect(TERMINAL_CONTRAST_THEME.background).toBe('#FFFFFF')
    expect(TERMINAL_CONTRAST_THEME.foreground).toBe('#0B1220')
    expect(TERMINAL_CONTRAST_THEME.brightWhite).toBeTruthy()
  })

  it('default prefs 派生自 settings schema（单一事实源）', () => {
    const t = defaultConfig('settings').terminal
    expect(DEFAULT_TERMINAL_PREFS.fontSize).toBe(t.fontSize)
    expect(DEFAULT_TERMINAL_PREFS.scrollback).toBe(t.scrollback)
    expect(DEFAULT_TERMINAL_PREFS.cursorStyle).toBe(t.cursorStyle)
    expect(DEFAULT_TERMINAL_PREFS.cursorBlink).toBe(t.cursorBlink)
    expect(DEFAULT_TERMINAL_PREFS.lineHeight).toBe(t.lineHeight)
  })

  it('resolveTerminalTheme 三模式', () => {
    // auto：内置浅色
    expect(resolveTerminalTheme('auto')).toEqual(TERMINAL_LIGHT_THEME)

    // custom：高对比
    expect(resolveTerminalTheme('custom')).toEqual(TERMINAL_CONTRAST_THEME)

    // follow-app：浅色 + 强调色光标/选区
    const follow = resolveTerminalTheme('follow-app', 'ocean')
    expect(follow.background).toBe(TERMINAL_LIGHT_THEME.background)
    expect(follow.cursor).toBe('#0EA5E9')
    expect(follow.selectionBackground).toContain('rgba(14, 165, 233')

    // 未知强调色回退 aurora
    const fallback = resolveTerminalTheme('follow-app', 'nope' as never)
    expect(fallback.cursor).toBe('#6366F1')
  })
})
