import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { CH } from '@wslpilot/shared'
import type { Logger } from '@wslpilot/kit'
import { markQuitting } from '../app-state'

export interface TrayOptions {
  getMainWindow: () => BrowserWindow | null
  logger: Logger
  closeBehavior: 'minimizeToTray' | 'quit'
}

let tray: Tray | null = null

function resolveIcon(): Electron.NativeImage {
  // 托盘用 16/32px ico，Windows 上最稳
  const candidates = [
    join(app.getAppPath(), 'resources/tray/WSLPilot-16.png'),
    join(app.getAppPath(), 'resources/WSLPilot-16.png'),
    join(app.getAppPath(), 'out/renderer/../resources/tray/WSLPilot-16.png'),
  ]
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    } catch {
      /* 继续尝试 */
    }
  }
  // 回退：生成空图标（仍可显示菜单）
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
    opts.getMainWindow()?.webContents.send(CH.appNavigate, path)
  }

  const menu = Menu.buildFromTemplate([
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
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked })
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

  tray.setContextMenu(menu)

  // 双击托盘图标显示主窗口
  tray.on('double-click', showWindow)

  opts.logger.info('tray created')
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
