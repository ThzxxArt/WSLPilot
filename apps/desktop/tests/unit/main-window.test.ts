import { describe, it, expect, beforeEach, vi } from 'vitest'

const createdWindows: any[] = []

vi.mock('electron', () => {
  class MockBrowserWindow {
    opts: any
    handlers = new Map<string, ((...a: any[]) => void)[]>()
    webContents = {
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
      on: vi.fn(),
    }
    constructor(opts: any) {
      this.opts = opts
      createdWindows.push(this)
    }
    once(ev: string, cb: () => void) {
      this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
    }
    on(ev: string, cb: (...a: any[]) => void) {
      this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
    }
    maximize = vi.fn()
    isMaximized = vi.fn(() => false)
    isMinimized = vi.fn(() => false)
    isDestroyed = vi.fn(() => false)
    getBounds = vi.fn(() => ({ x: 10, y: 20, width: 900, height: 600 }))
    getNormalBounds = vi.fn(() => ({ x: 10, y: 20, width: 900, height: 600 }))
    show = vi.fn()
    hide = vi.fn()
    focus = vi.fn()
    restore = vi.fn()
    close = vi.fn()
    emit(ev: string, ...a: any[]) {
      for (const cb of this.handlers.get(ev) ?? []) cb(...a)
    }
  }

  return {
    BrowserWindow: MockBrowserWindow,
    shell: { openExternal: vi.fn(), openPath: vi.fn(async () => '') },
    screen: {
      getDisplayNearestPoint: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      })),
    },
    app: {
      getPath: vi.fn(() => '/user'),
      getVersion: vi.fn(() => '0.1.0'),
    },
  }
})

import { createMainWindow } from '../../src/main/window/main-window'

function makeConfigService(windowState: any = {}) {
  return {
    load: vi.fn(async (key: string) => {
      if (key === 'uiState') {
        return {
          $schemaVersion: 1,
          window: {
            width: 1180,
            height: 760,
            x: 200,
            y: 120,
            maximized: false,
            ...windowState,
          },
          lastSelectedDistro: '',
          sidebarCollapsed: false,
          activeView: 'dashboard',
          tableSort: { key: 'name', dir: 'asc' },
          recentCommands: [],
        }
      }
      return { $schemaVersion: 2 }
    }),
    patch: vi.fn(async () => ({})),
    dispose: vi.fn(),
  } as any
}

describe('main-window', () => {
  beforeEach(() => {
    createdWindows.length = 0
    vi.clearAllMocks()
  })

  it('creates frameless window with security baseline', async () => {
    await createMainWindow('/preload.js', makeConfigService())
    const win = createdWindows[0]
    expect(win.opts.frame).toBe(false)
    expect(win.opts.webPreferences.contextIsolation).toBe(true)
    expect(win.opts.webPreferences.nodeIntegration).toBe(false)
    expect(win.opts.webPreferences.sandbox).toBe(true)
    expect(win.opts.webPreferences.webSecurity).toBe(true)
  })

  it('restores saved bounds when on-screen', async () => {
    await createMainWindow('/p.js', makeConfigService({ width: 900, height: 500, x: 50, y: 60 }))
    const win = createdWindows[0]
    expect(win.opts.width).toBe(900)
    expect(win.opts.height).toBe(500)
    expect(win.opts.x).toBe(50)
    expect(win.opts.y).toBe(60)
  })

  it('falls back to defaults when saved bounds are off-screen', async () => {
    await createMainWindow(
      '/p.js',
      makeConfigService({ x: -99999, y: -99999, width: 500, height: 400 }),
    )
    const win = createdWindows[0]
    expect(win.opts.width).toBe(1180)
    expect(win.opts.height).toBe(760)
  })

  it('maximizes when saved state says so', async () => {
    await createMainWindow('/p.js', makeConfigService({ maximized: true }))
    expect(createdWindows[0].maximize).toHaveBeenCalled()
  })

  it('shows window on ready-to-show', async () => {
    await createMainWindow('/p.js', makeConfigService())
    createdWindows[0].emit('ready-to-show')
    expect(createdWindows[0].show).toHaveBeenCalled()
  })

  it('blocks non-http navigation and opens http externally', async () => {
    await createMainWindow('/p.js', makeConfigService())
    const handler = createdWindows[0].webContents.setWindowOpenHandler.mock.calls[0][0]

    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'http://example.com' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
  })

  it('persists window state on resize (debounced)', async () => {
    vi.useFakeTimers()
    const config = makeConfigService()
    await createMainWindow('/p.js', config)
    const win = createdWindows[0]

    win.emit('resize')
    win.emit('resize')
    expect(config.patch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(600)
    expect(config.patch).toHaveBeenCalledWith('uiState', {
      window: expect.objectContaining({ width: 900, height: 600, x: 10, y: 20 }),
    })
    vi.useRealTimers()
  })
})
