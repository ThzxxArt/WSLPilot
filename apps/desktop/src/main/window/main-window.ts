import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export interface WindowState {
  width: number
  height: number
  x: number
  y: number
  maximized: boolean
}

const DEFAULT_STATE: WindowState = {
  width: 1180,
  height: 760,
  x: 200,
  y: 120,
  maximized: false,
}

/**
 * 创建主窗口。
 * 安全基线：contextIsolation + sandbox + 禁用 nodeIntegration。
 */
export function createMainWindow(preloadPath: string, state: Partial<WindowState> = {}): BrowserWindow {
  const s = { ...DEFAULT_STATE, ...state }

  const win = new BrowserWindow({
    width: s.width,
    height: s.height,
    x: s.x,
    y: s.y,
    minWidth: 720,
    minHeight: 520,
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    backgroundColor: '#F7F8FB',
    icon: join(__dirname, '../../resources/WSLPilot-256.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath,
    },
  })

  if (s.maximized) win.maximize()

  win.once('ready-to-show', () => win.show())

  // 外部链接：仅允许 http/https，且用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  return win
}
