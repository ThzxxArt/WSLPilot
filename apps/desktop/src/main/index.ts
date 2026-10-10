import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/router'
import { createConfigService } from './services/config-service'
import { createLogger, type Logger } from '@wslpilot/kit'
import { APP_NAME, CH, type TaskProgress } from '@wslpilot/shared'
import { createMainWindow } from './window/main-window'
import { decideClose } from './window/close-policy'
import { makeWindowOpenHandler, makeWillNavigateHandler } from './window/navigation-guard'
import { createTray } from './tray/tray'
import { createWslService } from './services/wsl-service'
import { createRegistryService } from './services/registry-service'
import { createPtyManager } from './services/pty-manager'
import { createTaskRunner, type TaskRecord } from './services/task-runner'
import { createIoService } from './services/io-service'
import { createWslConfService } from './services/wslconf-service'
import { createActionRunner } from './services/action-runner'
import { createFsBridge } from './services/fs-bridge'
import { createNetworkService } from './services/network-service'
import { createUsbipdService } from './services/usbipd-service'
import { readBootSettings } from './settings-boot'
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

  // 硬件加速开关须在 ready 前生效（settings.advanced.hardwareAcceleration）
  try {
    if (!readBootSettings(app.getPath('userData')).hardwareAcceleration) {
      app.disableHardwareAcceleration()
    }
  } catch {
    /* 读取失败按默认（开启）处理 */
  }

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
      return
    }
    // 窗口被销毁后重建（review M-12）：macOS dock / 二次唤起都走这里
    void ensureWindowRef?.()
  })

  // 安全基线：禁止新建窗口；http(s) 导航转系统浏览器，其余拦截（review M23）
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(makeWindowOpenHandler(shell))
    contents.on('will-navigate', makeWillNavigateHandler(shell))
  })

  app.setName(APP_NAME)
}

let mainWindow: BrowserWindow | null = null
/** 窗口重建入口（bootstrap 装配；activate 事件在 bootstrap 之前注册 — review M-12） */
let ensureWindowRef: (() => Promise<BrowserWindow | null>) | null = null

async function bootstrap() {
  Menu.setApplicationMenu(null)

  const userDataDir = app.getPath('userData')
  const logger = createLogger(userDataDir, 'info')
  bootstrapLogger = logger
  logger.info('app starting', { version: app.getVersion(), userDataDir })

  const configService = await createConfigService(userDataDir, logger)

  /** 设置副作用：日志级别 + 开机自启（settings.jsonc 为唯一真相源） */
  const applySettingsSideEffects = () => {
    try {
      const s = configService.loadSync('settings')
      logger.setLevel(s.advanced.logLevel)
      app.setLoginItemSettings({ openAtLogin: s.general.launchAtLogin })
    } catch (e) {
      logger.warn('apply settings side effects failed', { error: String(e) })
    }
  }
  applySettingsSideEffects()
  configService.onChange('settings', applySettingsSideEffects)

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

  // M6：端口转发 / 镜像模式 / 代理 + usbipd 设备
  const network = createNetworkService({ logger, configService })
  const devices = createUsbipdService({ logger })

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
    { wsl, registry, pty, io, tasks, wslconf, runner, fsBridge, network, devices },
  )

  /**
   * 退出清理必须**先于** loadURL/托盘注册：
   * loadURL 挂起期间用户退出（或 bootstrap 失败 app.quit()）也要能取消任务、
   * 杀终端、落盘配置（review M-11）。
   */
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

  /** 主窗口生命周期（close 决策 / closed 置空）——重建后也要重挂 */
  const attachWindowLifecycle = (): void => {
    const win = mainWindow
    if (!win) return
    win.on('closed', () => {
      mainWindow = null
    })
    // close 决策必须同步（preventDefault 只在同步派发期有效）。
    // 必须在 loadURL 之前注册，否则 loadURL 挂起期间关闭窗口会失去拦截（review M24）
    win.on('close', (e) => {
      const s = configService.loadSync('settings')
      const decision = decideClose(s.general.closeBehavior, isQuitting())
      if (decision.action === 'hide') {
        e.preventDefault()
        win.hide()
        return
      }
      if (decision.action === 'quit') {
        // 用户选择「关闭即退出」
        markQuitting()
        app.quit()
      }
    })
  }

  /** 窗口被销毁后重建（托盘点击 / activate 兜底 — review M-12） */
  const ensureWindow = async (): Promise<BrowserWindow | null> => {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
    mainWindow = await createMainWindow(join(__dirname, '../preload/index.js'), configService)
    attachWindowLifecycle()
    await mainWindow.loadURL(
      process.env.VITE_DEV_SERVER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`,
    )
    return mainWindow
  }
  ensureWindowRef = ensureWindow

  mainWindow = await createMainWindow(join(__dirname, '../preload/index.js'), configService)
  attachWindowLifecycle()

  createTray({
    getMainWindow: () => mainWindow,
    ensureWindow,
    logger,
    configService,
  })

  await mainWindow.loadURL(
    process.env.VITE_DEV_SERVER_URL ?? `file://${join(__dirname, '../renderer/index.html')}`,
  )

  logger.info('window ready')
}
