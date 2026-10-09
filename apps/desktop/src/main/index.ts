import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/router'
import { createConfigService } from './services/config-service'
import { createLogger, type Logger } from '@wslpilot/kit'
import { APP_NAME, CH, type TaskProgress } from '@wslpilot/shared'
import { createMainWindow } from './window/main-window'
import { decideClose } from './window/close-policy'
import { createTray } from './tray/tray'
import { createWslService } from './services/wsl-service'
import { createRegistryService } from './services/registry-service'
import { createPtyManager } from './services/pty-manager'
import { createTaskRunner, type TaskRecord } from './services/task-runner'
import { createIoService } from './services/io-service'
import { createWslConfService } from './services/wslconf-service'
import { createActionRunner } from './services/action-runner'
import { createFsBridge } from './services/fs-bridge'
import { isQuitting, markQuitting } from './app-state'

let bootstrapLogger: Logger | null = null

/** 全局异常兜底：绝不静默烂掉（review M1） */
function installGlobalGuards(getLogger: () => Logger | null): void {
  process.on('uncaughtException', (err) => {
    const log = getLogger()
    log?.error('uncaughtException', { error: err?.stack ?? String(err) })
  })
  process.on('unhandledRejection', (reason) => {
    const log = getLogger()
    log?.error('unhandledRejection', {
      error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    })
  })
}

// 单实例锁 —— 败者直接退出，不注册任何 bootstrap（M10）
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  installGlobalGuards(() => bootstrapLogger)

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
    bootstrap().catch((e: unknown) => {
      // bootstrap 失败必须可见，绝不静默挂死（review M1）
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
      bootstrapLogger?.error('bootstrap failed', { error: msg })
      dialog.showErrorBox('WSLPilot 启动失败', msg)
      app.quit()
    })
  })

  // 有托盘常驻：窗口关闭不退出；真正退出时才 quit
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting()) {
      app.quit()
    }
  })

  app.on('activate', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })

  // 安全基线：禁止新建窗口；http(s) 导航转系统浏览器，其余拦截（review M23）
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url)
      }
    })
  })

  app.setName(APP_NAME)
}

let mainWindow: BrowserWindow | null = null

async function bootstrap() {
  Menu.setApplicationMenu(null)

  const userDataDir = app.getPath('userData')
  const logger = createLogger(userDataDir, 'info')
  bootstrapLogger = logger
  logger.info('app starting', { version: app.getVersion(), userDataDir })

  const configService = await createConfigService(userDataDir, logger)

  mainWindow = await createMainWindow(join(__dirname, '../preload/index.js'), configService)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // close 决策必须同步（preventDefault 只在同步派发期有效）。
  // 必须在 loadURL 之前注册，否则 loadURL 挂起期间关闭窗口会失去拦截（review M24）
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

  const wsl = createWslService(logger)
  const registry = createRegistryService(logger)
  const pty = createPtyManager(
    logger,
    {
      onData: (ptyId, chunk) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CH.ptyData, { ptyId, chunk })
        }
      },
      onExit: (ptyId, code) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CH.ptyExit, { ptyId, code })
        }
      },
    },
    undefined,
    { defaultShell: () => configService.loadSync('settings').wsl.defaultShell },
  )

  // M4：长任务调度（导出/导入/迁移）→ task:progress 事件 + lastTaskResult 落盘
  const tasks = createTaskRunner({
    logger,
    onProgress: (p: TaskProgress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(CH.taskProgress, p)
      }
    },
    onFinish: (rec: TaskRecord) => {
      void configService
        .update('state', (s) => ({
          ...s,
          lastTaskResult: {
            type: rec.type,
            distro: rec.distro ?? '',
            status: rec.status,
            finishedAt: new Date().toISOString(),
          },
        }))
        .catch((e: unknown) => logger.warn('persist lastTaskResult failed', { error: String(e) }))
    },
  })

  const io = createIoService({ logger, wsl, registry, configService })

  // M5：wsl.conf 编辑 / 自定义动作 / 发行版内文件桥
  const wslconf = createWslConfService({ logger })
  const runner = createActionRunner({ logger, configService, wsl, pty })
  const fsBridge = createFsBridge({ logger })

  registerIpcHandlers(
    ipcMain,
    {
      configService,
      logger,
      getMainWindow: () => mainWindow,
      wsl,
      registry,
      pty,
      io,
      tasks,
    },
    { wsl, registry, pty, io, tasks, wslconf, runner, fsBridge },
  )

  createTray({
    getMainWindow: () => mainWindow,
    logger,
  })

  await mainWindow.loadURL(
    process.env.VITE_DEV_SERVER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`,
  )

  app.on('will-quit', (e) => {
    if (!isQuitting()) return
    // 先同步取消任务与终端，再等待写队列落盘（review M25）
    e.preventDefault()
    tasks.dispose()
    pty.killAll()
    void configService
      .flush()
      .catch(() => {})
      .finally(() => {
        configService.dispose()
        app.exit(0)
      })
  })

  logger.info('window ready')
}
