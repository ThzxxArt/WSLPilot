/** 领域模型 — 主/渲染进程共享 */
import type { AccentName } from './tokens'
export type { AccentName }

export type WslState =
  'Running' | 'Stopped' | 'Installing' | 'Uninstalling' | 'Converting' | 'Unknown'

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
export type CursorStyle = 'block' | 'underline' | 'bar'
export type TerminalTheme = 'auto' | 'follow-app' | 'custom'
export type BackupFormat = 'tar' | 'vhd'
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface GeneralSettings {
  autoRefreshOnStart: boolean
  pollIntervalMs: number
  locale: LocaleCode
  accent: AccentName
  closeBehavior: CloseBehavior
  launchAtLogin: boolean
  reduceMotion: boolean
}

export interface WslSettings {
  defaultShell: string
  autoShutdownAfterConfigChange: boolean
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
  /** 启动时自动检查更新（M7 自动更新） */
  autoUpdate: boolean
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

export interface ProxyConfig {
  useWindowsProxy: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
}

export interface NetworkConfig {
  $schemaVersion: number
  portForwarding: PortForwardRule[]
  proxy: ProxyConfig
}

/** `.wslconfig` 的 `[wsl2] networkingMode`（M6 镜像引导） */
export type NetworkMode = 'mirrored' | 'nat' | 'bridged' | 'virtioproxy' | 'unknown'

/** `netsh interface portproxy show all` 的一条系统级转发 */
export interface PortProxyEntry {
  listenAddress: string
  listenPort: number
  connectAddress: string
  connectPort: number
  /** netsh 隧道类型（当前固定 v4tov4） */
  kind: string
}

/** Windows 系统代理（`useWindowsProxy` 时作为回退来源） */
export interface WindowsProxyInfo {
  enabled: boolean
  /** ProxyServer 原值（可能形如 `127.0.0.1:7890` 或 `http=…;https=…`） */
  server: string
  /** ProxyOverride（分号分隔，对应 no_proxy） */
  override: string
}

/** `network:status` 返回（M6） */
export interface NetworkStatus {
  /** `%UserProfile%\.wslconfig` 绝对路径 */
  wslconfigPath: string
  wslconfigExists: boolean
  mode: NetworkMode
  /** 检测到的 networkingMode 原值（未配置为 ''） */
  modeRaw: string
  /** 非镜像模式时建议引导开启镜像 */
  mirrorRecommended: boolean
  /** 系统当前端口代理表（netsh show all） */
  portProxy: PortProxyEntry[]
  windowsProxy: WindowsProxyInfo | null
}

/** `network:proxyState` 返回（发行版内代理脚本当前状态） */
export interface ProxyScriptState {
  path: string
  exists: boolean
  content: string
}

/** usbipd 设备状态（`usbipd list` STATE 列） */
export type UsbipdState = 'not-attached' | 'shared' | 'attached' | 'not-shared' | 'unknown'

export interface UsbDevice {
  busId: string
  vid: string
  pid: string
  description: string
  state: UsbipdState
}

export interface UsbipdStatus {
  installed: boolean
  version: string
  /** 调用失败原因（已安装但服务异常等——区别于「未安装」，避免误导重装） */
  error?: string
}

export type UsbipdOp = 'bind' | 'unbind' | 'attach' | 'detach'

export interface Metrics {
  memUsedKB: number
  memTotalKB: number
  /** 磁盘（KB）。无法采样时为 0，展示层显示 — */
  diskUsedKB: number
  diskTotalKB: number
  cpuPercent: number
  sampledAt: string
}

/** 驾驶舱全局概览指标（metrics:sample('*') 返回） */
export interface OverviewMetrics {
  runningCount: number
  totalCount: number
  memUsedKB: number
  memTotalKB: number
  diskUsedKB: number
  diskTotalKB: number
  cpuPercent: number
  sampledAt: string
  perDistro: Record<string, Metrics>
}

/** 零值概览（无运行中/无数据） */
export const EMPTY_OVERVIEW: OverviewMetrics = {
  runningCount: 0,
  totalCount: 0,
  memUsedKB: 0,
  memTotalKB: 0,
  diskUsedKB: 0,
  diskTotalKB: 0,
  cpuPercent: 0,
  sampledAt: '',
  perDistro: {},
}

export type TaskType =
  'install' | 'export' | 'import' | 'move' | 'convert' | 'action' | 'network' | 'device'
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

/** 任务句柄；terminal 动作附带临时 PTY 会话 id 与目标发行版 */
export type TaskHandle = { taskId: string; ptyId?: string; distro?: string }

/** Lxss 注册表详情（registry:detail 返回 — M5 注册表详情） */
export interface RegistryDetail {
  guid: string
  distributionName: string
  basePath?: string
  version?: 1 | 2
  defaultUid?: number
  /** REG_DWORD Flags（发行版标志位） */
  flags?: number
  /** reg query 原始键值（字符串形态，展示用） */
  values: Record<string, string>
}

/** 发行版内文件读取结果（fs:read — 文本优先，二进制/超限截断） */
export interface FsReadResult {
  text: string
  sizeBytes: number
  /** 超过读取上限被截断（编辑器只读展示） */
  truncated: boolean
  /** 非 UTF-8 文本（二进制），text 为空 */
  binary: boolean
}

/** 备份文件信息（io:listBackups 返回） */
export interface BackupFileInfo {
  /** 文件名（不含目录） */
  name: string
  path: string
  sizeBytes: number
  modifiedAt: string
  format: BackupFormat
}

/** io:export 入参 */
export interface IoExportRequest {
  name: string
  path: string
  format: BackupFormat
}

/** io:import 入参 */
export interface IoImportRequest {
  /** 新发行版名称 */
  name: string
  /** 安装位置（就地导入时忽略） */
  installPath: string
  /** 归档 / vhdx 路径 */
  archivePath: string
  format: BackupFormat
  version: 1 | 2
  /** 就地导入（wsl --import-in-place，仅 vhd） */
  inPlace: boolean
}

/** io:move 入参 */
export interface IoMoveRequest {
  name: string
  path: string
  /** 运行中时先 terminate（DISTRO_RUNNING 安全兜底） */
  terminateFirst: boolean
}

/** 系统文件对话框过滤器 */
export interface FileFilter {
  name: string
  extensions: string[]
}

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

/** 自动更新状态（M7） */
export type UpdateStatus =
  'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

/** `update:status` 返回 / `update:changed` 事件载荷 */
export interface UpdateState {
  status: UpdateStatus
  /** 可用/已下载的版本号 */
  version?: string
  /** 发布说明摘要 */
  releaseNotes?: string
  /** 下载进度 0-100（downloading 期间） */
  percent?: number
  error?: string
  /** 当前版本 */
  currentVersion: string
  /** 更新源（feed URL）；未配置发布源时为空 */
  feedUrl?: string
}

/** 代码签名状态（M7 签名 + SmartScreen 说明） */
export interface SignatureStatus {
  /** 是否完成检测（非 Windows / 检测失败为 false） */
  checked: boolean
  signed: boolean
  /** 证书主题（签名时） */
  subject?: string
  /** 检测细节（PowerShell 原始状态等） */
  detail?: string
  /** 未签名时的 SmartScreen 提示（界面直接展示） */
  smartscreenNote?: string
}
