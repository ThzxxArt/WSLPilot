import { describe, it, expect } from 'vitest'
import {
  TERMINAL_LIGHT_THEME,
  TERMINAL_CONTRAST_THEME,
  DEFAULT_TERMINAL_PREFS,
  hexToRgba,
  normalizeFontFamily,
  resolveTerminalTheme,
} from '../../src/renderer/features/terminal/theme'
import { defaultConfig } from '@wslpilot/shared'

describe('normalizeFontFamily（含空格字体名补引号 — review 度量错位根治）', () => {
  it('含空格的名字补引号、单段名字原样', () => {
    expect(normalizeFontFamily('Cascadia Mono, Consolas, monospace')).toBe(
      '"Cascadia Mono", Consolas, monospace',
    )
    expect(normalizeFontFamily('Consolas')).toBe('Consolas')
    expect(normalizeFontFamily('monospace')).toBe('monospace')
  })

  it('已引号的名字不再重复引号；空段剔除；防注入去内嵌引号', () => {
    expect(normalizeFontFamily('"Cascadia Mono", Consolas')).toBe('"Cascadia Mono", Consolas')
    expect(normalizeFontFamily('  Consolas , , monospace ')).toBe('Consolas, monospace')
    expect(normalizeFontFamily('a"b c')).toBe('"ab c"')
  })

  it('空输入返回空串', () => {
    expect(normalizeFontFamily('')).toBe('')
    expect(normalizeFontFamily(undefined as never)).toBe('')
  })
})

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

  it('hexToRgba 支持 #rrggbb 与 #rgb 短写法（review 0.1.2 根治）', () => {
    expect(hexToRgba('#6366F1', 0.5)).toBe('rgba(99, 102, 241, 0.5)')
    // #abc → #aabbcc
    expect(hexToRgba('#abc', 1)).toBe('rgba(170, 187, 204, 1)')
    expect(hexToRgba('f00', 0.25)).toBe('rgba(255, 0, 0, 0.25)')
    // 非法输入回退默认紫
    expect(hexToRgba('nope', 0.5)).toBe('rgba(99, 102, 241, 0.5)')
    expect(hexToRgba('#abcd', 0.5)).toBe('rgba(99, 102, 241, 0.5)')
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
