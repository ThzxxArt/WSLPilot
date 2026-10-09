import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/router'
import { createConfigService } from './services/config-service'
import { createLogger } from '@wslpilot/kit'
import { APP_NAME } from '@wslpilot/shared'
import { createMainWindow } from './window/main-window'

// 单实例锁
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

let mainWindow: BrowserWindow | null = null

async function bootstrap() {
  const userDataDir = app.getPath('userData')
  const logger = createLogger(userDataDir, 'info')
  logger.info('app starting', { version: app.getVersion(), userDataDir })

  const configService = await createConfigService(userDataDir, logger)

  mainWindow = createMainWindow(join(__dirname, '../preload/index.js'))
  registerIpcHandlers(ipcMain, { configService, logger, getMainWindow: () => mainWindow })

  await mainWindow.loadURL(
    process.env.VITE_DEV_SERVER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`,
  )

  logger.info('window ready')
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void bootstrap()
  }
})

// 安全基线：禁止新建窗口
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
})

// 设置应用名称（任务栏 / 标题）
app.setName(APP_NAME)
