import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { CH } from '@wslpilot/shared'
import type { Logger } from '@wslpilot/kit'
import type { ConfigService } from '../services/config-service'
import { markQuitting } from '../app-state'

export interface TrayOptions {
  getMainWindow: () => BrowserWindow | null
  logger: Logger
  configService: ConfigService
}

let tray: Tray | null = null

function resolveIcon(): Electron.NativeImage {
  // 打包后 extraResources → <resources>/tray/；开发态 → apps/desktop/resources/tray/
  const candidates = [
    join(process.resourcesPath ?? '', 'tray', 'WSLPilot-32.png'),
    join(process.resourcesPath ?? '', 'tray', 'WSLPilot-16.png'),
    join(app.getAppPath(), 'resources', 'tray', 'WSLPilot-32.png'),
    join(app.getAppPath(), 'resources', 'tray', 'WSLPilot-16.png'),
  ]
  for (const p of candidates) {
    if (!p || p.startsWith('tray')) continue
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    } catch {
      /* 继续尝试 */
    }
  }
  return nativeImage.createEmpty()
}

export function createTray(opts: TrayOptions): Tray {
  if (tray) return tray

  const icon = resolveIcon()
  tray = new Tray(icon)
  tray.setToolTip('WSLPilot — WSL 的驾驶舱')

  const showWindow = () => {
    const win = opts.getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const navigate = (path: string) => {
    showWindow()
    const win = opts.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(CH.appNavigate, path)
    }
  }

  /** 菜单按 settings 现值构建；勾选后写回 settings（主进程同步系统登录项） */
  const buildMenu = () => {
    const launchAtLogin = opts.configService.loadSync('settings').general.launchAtLogin
    return Menu.buildFromTemplate([
      {
        label: '打开 WSLPilot',
        click: showWindow,
      },
      { type: 'separator' },
      {
        label: '驾驶舱',
        click: () => navigate('/dashboard'),
      },
      {
        label: '终端',
        click: () => navigate('/terminal'),
      },
      {
        label: '设置',
        click: () => navigate('/settings'),
      },
      { type: 'separator' },
      {
        label: '打开配置目录',
        click: () => {
          void shell.openPath(app.getPath('userData'))
        },
      },
      { type: 'separator' },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: launchAtLogin,
        click: (item) => {
          // settings.jsonc 为真相源；applySettingsSideEffects 同步系统登录项
          void opts.configService
            .patch('settings', { general: { launchAtLogin: item.checked } })
            .catch((e: unknown) =>
              opts.logger.warn('toggle launchAtLogin failed', { error: String(e) }),
            )
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          markQuitting()
          app.quit()
        },
      },
    ])
  }

  const refreshMenu = () => tray?.setContextMenu(buildMenu())
  refreshMenu()
  // 设置变更后重建菜单（勾选态与设置页保持一致）
  opts.configService.onChange('settings', refreshMenu)

  tray.on('double-click', showWindow)

  opts.logger.info('tray created')
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
