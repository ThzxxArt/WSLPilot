/** 领域模型 — 主/渲染进程共享 */
import type { AccentName } from './tokens'
export type { AccentName }

export type WslState = 'Running' | 'Stopped' | 'Installing' | 'Uninstalling' | 'Converting' | 'Unknown'

/** 来自 wsl.exe 实时查询的系统事实 */
export interface DistroRuntime {
  name: string
  state: WslState
  version: 1 | 2
  isDefault: boolean
  basePath?: string
  defaultUid?: number
  guid?: string
}

/** 来自 distros.jsonc 的用户元数据 */
export interface DistroMeta {
  name: string
  alias: string
  tags: string[]
  color: string
  icon: string
  note: string
  startupCwd: string
  pinned: boolean
  quickActions: string[]
}

/** 运行时 + 元数据的合并视图 */
export interface DistroView extends DistroRuntime {
  meta?: DistroMeta
}

export type LocaleCode = 'system' | 'zh-CN' | 'en-US'
export type CloseBehavior = 'minimizeToTray' | 'quit'
export type InstallSource = 'store' | 'web'
export type CursorStyle = 'block' | 'underline' | 'bar'
export type TerminalTheme = 'auto' | 'follow-app' | 'custom'
export type BackupFormat = 'tar' | 'vhd'
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface GeneralSettings {
  autoRefreshOnStart: boolean
  pollIntervalMs: number
  locale: LocaleCode
  theme: 'light'
  accent: AccentName
  closeBehavior: CloseBehavior
  launchAtLogin: boolean
  reduceMotion: boolean
}

export interface WslSettings {
  defaultShell: string
  autoShutdownAfterConfigChange: boolean
  installSource: InstallSource
}

export interface TerminalSettings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  theme: TerminalTheme
}

export interface BackupSettings {
  defaultDir: string
  format: BackupFormat
  keepRecent: number
  autoBackupBeforeDestructive: boolean
}

export interface AdvancedSettings {
  showRawCommand: boolean
  confirmDestructive: boolean
  logLevel: LogLevel
  hardwareAcceleration: boolean
}

export interface AppSettings {
  $schemaVersion: number
  general: GeneralSettings
  wsl: WslSettings
  terminal: TerminalSettings
  backup: BackupSettings
  advanced: AdvancedSettings
}

export type ActionScope = 'distro' | 'global'

export interface WslAction {
  id: string
  label: string
  description?: string
  icon?: string
  scope: ActionScope
  program: string
  args: string[]
  user?: string
  cwd?: string
  terminal: boolean
  confirm: boolean
}

export interface PortForwardRule {
  id: string
  distro: string
  listenAddress: string
  listenPort: number
  connectAddress: string
  connectPort: number
  enabled: boolean
  protocol: 'tcp' | 'udp'
}

export interface NetworkConfig {
  $schemaVersion: number
  portForwarding: PortForwardRule[]
  proxy: {
    useWindowsProxy: boolean
    httpProxy: string
    httpsProxy: string
    noProxy: string
  }
}

export interface Metrics {
  memUsedKB: number
  memTotalKB: number
  diskUsed: string
  diskTotal: string
  cpuPercent: number
  sampledAt: string
}

export type TaskType = 'install' | 'export' | 'import' | 'move' | 'convert' | 'action'
export type TaskStatus = 'running' | 'success' | 'failed' | 'canceled'

export interface TaskProgress {
  taskId: string
  type: TaskType
  distro?: string
  percent: number | null
  message: string
  logLine?: string
  status: TaskStatus
}

export type TaskHandle = { taskId: string }

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  modifiedAt?: string
}

/** 配置文件键 → 内容类型映射 */
export interface ConfigMap {
  settings: AppSettings
  distros: { $schemaVersion: number; distros: DistroMeta[] }
  actions: { $schemaVersion: number; actions: WslAction[] }
  network: NetworkConfig
  uiState: {
    $schemaVersion: number
    window: { width: number; height: number; x: number; y: number; maximized: boolean }
    lastSelectedDistro: string
    sidebarCollapsed: boolean
    activeView: string
    tableSort: { key: string; dir: 'asc' | 'desc' }
    recentCommands: string[]
  }
  state: {
    $schemaVersion: number
    lastScanAt: string
    lastMetrics: Record<string, Metrics>
    lastTaskResult?: {
      type: TaskType
      distro: string
      status: TaskStatus
      finishedAt: string
    }
  }
}

export type ConfigKey = keyof ConfigMap
