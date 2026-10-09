import { describe, it, expect } from 'vitest'
import {
  TERMINAL_LIGHT_THEME,
  DEFAULT_TERMINAL_PREFS,
} from '../../src/renderer/features/terminal/theme'

describe('terminal theme', () => {
  it('light theme has readable dark-on-light colors', () => {
    expect(TERMINAL_LIGHT_THEME.background).toBe('#FBFCFE')
    expect(TERMINAL_LIGHT_THEME.foreground).toBe('#1E293B')
    expect(TERMINAL_LIGHT_THEME.cursor).toBeTruthy()
    // 16 色齐全
    expect(TERMINAL_LIGHT_THEME.black).toBeTruthy()
    expect(TERMINAL_LIGHT_THEME.brightWhite).toBeTruthy()
  })

  it('default prefs match design defaults', () => {
    expect(DEFAULT_TERMINAL_PREFS.fontSize).toBe(14)
    expect(DEFAULT_TERMINAL_PREFS.scrollback).toBe(5000)
    expect(DEFAULT_TERMINAL_PREFS.cursorStyle).toBe('block')
    expect(DEFAULT_TERMINAL_PREFS.cursorBlink).toBe(true)
  })
})
