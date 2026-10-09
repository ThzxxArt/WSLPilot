import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/router'
import { createConfigService } from './services/config-service'
import { createLogger } from '@wslpilot/kit'
import { APP_NAME } from '@wslpilot/shared'
import { createMainWindow } from './window/main-window'
import { createTray } from './tray/tray'
import { isQuitting, markQuitting } from './app-state'

// 单实例锁
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

let mainWindow: BrowserWindow | null = null

async function bootstrap() {
  // 去掉系统自带菜单栏（窗口用自绘标题栏）
  Menu.setApplicationMenu(null)

  const userDataDir = app.getPath('userData')
  const logger = createLogger(userDataDir, 'info')
  logger.info('app starting', { version: app.getVersion(), userDataDir })

  const configService = await createConfigService(userDataDir, logger)

  mainWindow = await createMainWindow(join(__dirname, '../preload/index.js'), configService)
  registerIpcHandlers(ipcMain, {
    configService,
    logger,
    getMainWindow: () => mainWindow,
  })

  // 系统托盘
  const settings = await configService.load('settings')
  createTray({
    getMainWindow: () => mainWindow,
    logger,
    closeBehavior: settings.general.closeBehavior,
  })

  await mainWindow.loadURL(
    process.env.VITE_DEV_SERVER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`,
  )

  // 最小化到托盘而非退出（可配置）
  mainWindow.on('close', (e) => {
    const behavior = settings.general.closeBehavior
    if (behavior === 'minimizeToTray' && !isQuitting()) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  app.on('will-quit', () => {
    configService.dispose()
  })

  logger.info('window ready')
}

app.on('before-quit', () => {
  markQuitting()
})

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  // 有托盘常驻时窗口关闭不退出
  if (process.platform !== 'darwin' && isQuitting()) {
    app.quit()
  }
})

app.on('activate', () => {
  mainWindow?.show()
})

// 安全基线：禁止新建窗口
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
})

// 设置应用名称（任务栏 / 标题）
app.setName(APP_NAME)
