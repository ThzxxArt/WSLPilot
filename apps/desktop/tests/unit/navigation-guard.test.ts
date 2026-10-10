import { describe, it, expect, vi } from 'vitest'
import {
  decideExternalUrl,
  makeWindowOpenHandler,
  makeWillNavigateHandler,
} from '../../src/main/window/navigation-guard'

describe('decideExternalUrl — 外链白名单', () => {
  it('放行 http/https', () => {
    expect(decideExternalUrl('https://example.com').openExternal).toBe(true)
    expect(decideExternalUrl('http://example.com/a?b=1').openExternal).toBe(true)
  })

  it('大小写变体不得绕过白名单', () => {
    expect(decideExternalUrl('HTTPS://example.com').openExternal).toBe(true)
    expect(decideExternalUrl('Http://example.com').openExternal).toBe(true)
    expect(decideExternalUrl('  https://example.com  ').openExternal).toBe(true)
  })

  it('拒绝一切非 http(s) 协议（安全基线）', () => {
    for (const url of [
      'file:///C:/Windows/System32/cmd.exe',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'about:blank',
      'vbscript:x',
      'ws://evil',
      'chrome://settings',
      '//evil.com',
      '/relative/path',
      '',
      '   ',
    ]) {
      expect(decideExternalUrl(url).openExternal, url).toBe(false)
    }
  })

  it('非字符串入参不抛错', () => {
    expect(decideExternalUrl(null as unknown as string).openExternal).toBe(false)
    expect(decideExternalUrl(undefined as unknown as string).openExternal).toBe(false)
    expect(decideExternalUrl(123 as unknown as string).openExternal).toBe(false)
  })
})

describe('makeWindowOpenHandler — 禁止新建窗口', () => {
  it('永远返回 deny', () => {
    const shell = { openExternal: vi.fn() }
    const handler = makeWindowOpenHandler(shell)
    expect(handler({ url: 'https://a.com' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
  })

  it('http(s) 转系统浏览器，其余不外开', () => {
    const shell = { openExternal: vi.fn() }
    const handler = makeWindowOpenHandler(shell)
    handler({ url: 'https://docs.rs' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://docs.rs')

    shell.openExternal.mockClear()
    handler({ url: 'file:///etc/passwd' })
    handler({ url: 'javascript:alert(1)' })
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('openExternal 失败不抛出（fire-and-forget）', () => {
    const shell = {
      openExternal: vi.fn(() => {
        throw new Error('boom')
      }),
    }
    const handler = makeWindowOpenHandler(shell)
    expect(() => handler({ url: 'https://a.com' })).not.toThrow()
  })
})

describe('makeWillNavigateHandler — 拦截导航', () => {
  it('一律 preventDefault，http(s) 转浏览器', () => {
    const shell = { openExternal: vi.fn() }
    const handler = makeWillNavigateHandler(shell)
    const preventDefault = vi.fn()
    handler({ preventDefault }, 'https://example.com')
    expect(preventDefault).toHaveBeenCalled()
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('非 http(s) 拦截但不外开', () => {
    const shell = { openExternal: vi.fn() }
    const handler = makeWillNavigateHandler(shell)
    const preventDefault = vi.fn()
    handler({ preventDefault }, 'file:///x')
    expect(preventDefault).toHaveBeenCalled()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})
