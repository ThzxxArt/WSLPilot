import { describe, it, expect, beforeEach, vi } from 'vitest'

const trayInstances: any[] = []
const trayMenu = { items: [] as any[] }

vi.mock('electron', () => {
  class MockTray {
    menu: any = null
    tooltip = ''
    handlers = new Map<string, (...a: any[]) => void>()
    constructor(_icon: any) {
      trayInstances.push(this)
    }
    setToolTip(t: string) {
      this.tooltip = t
    }
    setContextMenu(m: any) {
      this.menu = m
    }
    on(ev: string, cb: (...a: any[]) => void) {
      this.handlers.set(ev, cb)
    }
    destroy() {
      this.destroyed = true
    }
    destroyed = false
  }

  return {
    app: {
      getAppPath: vi.fn(() => '/app'),
      getPath: vi.fn(() => '/user'),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      setLoginItemSettings: vi.fn(),
      quit: vi.fn(),
    },
    Tray: MockTray,
    Menu: {
      buildFromTemplate: vi.fn((tpl: any[]) => {
        trayMenu.items = tpl
        return trayMenu
      }),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({ isEmpty: () => true })),
      createEmpty: vi.fn(() => ({ isEmpty: () => true })),
    },
    shell: {
      openPath: vi.fn(async () => ''),
    },
    CH: {},
  }
})

// markQuitting 依赖
vi.mock('../../src/main/app-state', () => ({
  markQuitting: vi.fn(),
  isQuitting: vi.fn(() => false),
}))

import { createTray, destroyTray } from '../../src/main/tray/tray'
import { markQuitting } from '../../src/main/app-state'

function makeLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  } as any
}

describe('tray', () => {
  beforeEach(() => {
    trayInstances.length = 0
    trayMenu.items = []
    vi.clearAllMocks()
    destroyTray()
  })

  it('creates tray with tooltip and context menu', () => {
    const win = { webContents: { send: vi.fn() }, isMinimized: () => false, show: vi.fn(), focus: vi.fn() }
    const tray = createTray({
      getMainWindow: () => win as any,
      logger: makeLogger(),
      closeBehavior: 'minimizeToTray',
    })

    expect(tray.tooltip).toContain('WSLPilot')
    expect(tray.menu).toBeTruthy()
    const labels = trayMenu.items.map((i: any) => i.label).filter(Boolean)
    expect(labels).toContain('打开 WSLPilot')
    expect(labels).toContain('驾驶舱')
    expect(labels).toContain('设置')
    expect(labels).toContain('退出')
  })

  it('is a singleton (second call returns same tray)', () => {
    const opts = {
      getMainWindow: () => null,
      logger: makeLogger(),
      closeBehavior: 'quit' as const,
    }
    const t1 = createTray(opts)
    const t2 = createTray(opts)
    expect(t1).toBe(t2)
    expect(trayInstances).toHaveLength(1)
  })

  it('double-click shows window', () => {
    const win = { isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } }
    const tray = createTray({
      getMainWindow: () => win as any,
      logger: makeLogger(),
      closeBehavior: 'quit',
    })

    tray.handlers.get('double-click')!()
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('menu navigate sends CH.appNavigate and shows window', () => {
    const win = { isMinimized: () => false, show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } }
    createTray({
      getMainWindow: () => win as any,
      logger: makeLogger(),
      closeBehavior: 'quit',
    })

    const settingsItem = trayMenu.items.find((i: any) => i.label === '设置')
    settingsItem.click()
    expect(win.show).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('app:navigate', '/settings')
  })

  it('quit menu item marks quitting and quits', () => {
    createTray({
      getMainWindow: () => null,
      logger: makeLogger(),
      closeBehavior: 'quit',
    })
    const quitItem = trayMenu.items.find((i: any) => i.label === '退出')
    quitItem.click()
    expect(markQuitting).toHaveBeenCalled()
  })

  it('destroyTray destroys instance', () => {
    const t = createTray({
      getMainWindow: () => null,
      logger: makeLogger(),
      closeBehavior: 'quit',
    })
    destroyTray()
    expect(t.destroyed).toBe(true)
  })
})
