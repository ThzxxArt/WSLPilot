import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/router'
import { createConfigService } from './services/config-service'
import { createLogger } from '@wslpilot/kit'
import { APP_NAME } from '@wslpilot/shared'
import { createMainWindow } from './window/main-window'
import { decideClose } from './window/close-policy'
import { createTray } from './tray/tray'
import { createWslService } from './services/wsl-service'
import { createRegistryService } from './services/registry-service'
import { isQuitting, markQuitting } from './app-state'

// 单实例锁 —— 败者直接退出，不注册任何 bootstrap（M10）
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

  app.on('before-quit', () => {
    markQuitting()
  })

  app.whenReady().then(() => {
    void bootstrap()
  })

  // 有托盘常驻：窗口关闭不退出；真正退出时才 quit
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting()) {
      app.quit()
    }
  })

  app.on('activate', () => {
    // 由 bootstrap 内的 mainWindow 引用处理
  })

  // 安全基线：禁止新建窗口
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
  })

  app.setName(APP_NAME)
}

let mainWindow: BrowserWindow | null = null

async function bootstrap() {
  Menu.setApplicationMenu(null)

  const userDataDir = app.getPath('userData')
  const logger = createLogger(userDataDir, 'info')
  logger.info('app starting', { version: app.getVersion(), userDataDir })

  const configService = await createConfigService(userDataDir, logger)

  mainWindow = await createMainWindow(join(__dirname, '../preload/index.js'), configService)

  const wsl = createWslService(logger)
  const registry = createRegistryService(logger)

  registerIpcHandlers(
    ipcMain,
    {
      configService,
      logger,
      getMainWindow: () => mainWindow,
      wsl,
      registry,
    },
    { wsl, registry },
  )

  createTray({
    getMainWindow: () => mainWindow,
    logger,
  })

  await mainWindow.loadURL(
    process.env.VITE_DEV_SERVER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`,
  )

  // close 决策必须同步（preventDefault 只在同步派发期有效）
  mainWindow.on('close', (e) => {
    const s = configService.loadSync('settings')
    const decision = decideClose(s.general.closeBehavior, isQuitting())
    if (decision.action === 'hide') {
      e.preventDefault()
      mainWindow?.hide()
      return
    }
    if (decision.action === 'quit') {
      // 用户选择「关闭即退出」
      markQuitting()
      app.quit()
    }
  })

  app.on('will-quit', () => {
    configService.dispose()
  })

  logger.info('window ready')
}
