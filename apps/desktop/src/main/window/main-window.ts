import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import type { ConfigService } from '../services/config-service'
import { makeWindowOpenHandler } from './navigation-guard'

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
 * 窗口位置/尺寸持久化到 ui-state.jsonc。
 */
export async function createMainWindow(
  preloadPath: string,
  configService: ConfigService,
): Promise<BrowserWindow> {
  const uiState = await configService.load('uiState')
  const saved = uiState.window ?? DEFAULT_STATE

  // 多显示器越界保护
  const display = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y })
  const bounds = display.workArea
  const inside =
    saved.x >= bounds.x - 100 &&
    saved.y >= bounds.y - 100 &&
    saved.x + saved.width <= bounds.x + bounds.width + 100 &&
    saved.y + saved.height <= bounds.y + bounds.height + 100

  const s: WindowState = inside ? { ...DEFAULT_STATE, ...saved } : { ...DEFAULT_STATE }

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

  // 持久化窗口状态（防抖：移动/缩放时每 500ms 落盘一次）
  let saveTimer: NodeJS.Timeout | null = null
  const clearSaveTimer = () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }
  const persistState = () => {
    clearSaveTimer()
    saveTimer = setTimeout(() => {
      saveTimer = null
      // 窗口可能在防抖期间销毁（review M2）
      if (win.isDestroyed()) return
      const isMax = win.isMaximized()
      const bounds = isMax ? win.getNormalBounds() : win.getBounds()
      void configService
        .patch('uiState', {
          window: {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
            maximized: isMax,
          },
        })
        .catch(() => {})
    }, 500)
  }
  win.on('resize', persistState)
  win.on('move', persistState)
  win.on('maximize', persistState)
  win.on('unmaximize', persistState)
  win.on('closed', clearSaveTimer)

  // 外部链接：仅允许 http/https，且用系统浏览器打开（与 index.ts 共用同一守卫）
  win.webContents.setWindowOpenHandler(makeWindowOpenHandler(shell))

  return win
}
