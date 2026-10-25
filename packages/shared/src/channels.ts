/** IPC 通道名常量 — 主进程 / 预加载 / 渲染进程共享，避免拼写漂移 */
export const CH = {
  // distros
  distrosList: 'distros:list',
  distrosStart: 'distros:start',
  distrosTerminate: 'distros:terminate',
  distrosShutdown: 'distros:shutdown',
  distrosSetDefault: 'distros:setDefault',
  distrosSetVersion: 'distros:setVersion',
  distrosUnregister: 'distros:unregister',
  distrosInstall: 'distros:install',
  distrosListOnline: 'distros:listOnline',
  // 磁盘管理（0.1.3）：稀疏磁盘等 wsl --manage 子操作
  distrosSetSparse: 'distros:setSparse',
  // 存储与身份（0.1.4）：compact / resize / set-default-user
  distrosCompact: 'distros:compact',
  distrosResize: 'distros:resize',
  distrosSetDefaultUser: 'distros:setDefaultUser',

  // io
  ioExport: 'io:export',
  ioImport: 'io:import',
  ioMove: 'io:move',
  // 克隆发行版（0.1.3）：导出→导入组合流程
  ioClone: 'io:clone',
  ioListBackups: 'io:listBackups',
  ioCleanupBackups: 'io:cleanupBackups',

  // meta
  metaGet: 'meta:get',
  metaSet: 'meta:set',

  // registry
  registryDetail: 'registry:detail',

  // config
  configGet: 'config:get',
  configSet: 'config:set',
  configOpenExternal: 'config:openExternal',
  configChanged: 'config:changed',
  configConflict: 'config:conflict',
  configResolveConflict: 'config:resolveConflict',

  // wsl.conf（发行版内 /etc/wsl.conf）
  wslconfRead: 'wslconf:read',
  wslconfWrite: 'wslconf:write',

  // .wslconfig（全局 %UserProfile%\.wslconfig — 0.1.3）
  wslconfigRead: 'wslconfig:read',
  wslconfigWrite: 'wslconfig:write',

  // clipboard（主进程 Electron clipboard — 0.1.3：终端复制/粘贴可靠通道）
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',

  // pty
  ptyCreate: 'pty:create',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  ptyList: 'pty:list',
  ptyMaxSessions: 'pty:maxSessions',
  ptyHostInfo: 'pty:host',

  // fs
  fsReadDir: 'fs:readDir',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsRevealInExplorer: 'fs:revealInExplorer',

  // metrics / tasks
  metricsSample: 'metrics:sample',
  metricsOverview: 'metrics:overview',
  taskCancel: 'task:cancel',
  taskProgress: 'task:progress',

  // actions
  actionRun: 'action:run',

  // network（M6）
  networkStatus: 'network:status',
  networkApply: 'network:apply',
  networkApplyAll: 'network:applyAll',
  networkRemove: 'network:remove',
  networkProxyApply: 'network:proxyApply',
  networkProxyClear: 'network:proxyClear',
  networkProxyState: 'network:proxyState',

  // devices（M6 usbipd，可选）
  devicesStatus: 'devices:status',
  devicesList: 'devices:list',
  devicesBind: 'devices:bind',
  devicesUnbind: 'devices:unbind',
  devicesAttach: 'devices:attach',
  devicesDetach: 'devices:detach',

  // app
  appGetVersion: 'app:getVersion',
  appOpenConfigDir: 'app:openConfigDir',
  appWindowMinimize: 'app:windowMinimize',
  appWindowMaximize: 'app:windowMaximize',
  appWindowClose: 'app:windowClose',
  appNavigate: 'app:navigate',
  appGetWslVersion: 'app:getWslVersion',
  // WSL 本体生命周期（0.1.3）：环境体检 / 更新 / 默认版本
  appWslEnv: 'app:wslEnv',
  appWslUpdate: 'app:wslUpdate',
  appWslSetDefaultVersion: 'app:wslSetDefaultVersion',
  appPickDirectory: 'app:pickDirectory',
  appPickSaveFile: 'app:pickSaveFile',
  appPickOpenFile: 'app:pickOpenFile',
  appOpenPath: 'app:openPath',
  // 外链专用通道（review 0.1.2 审计修复）：openPath 只允许目录，官网/文档链接必须有独立出口
  appOpenExternal: 'app:openExternal',
  appSignatureStatus: 'app:signatureStatus',

  // diagnostics（M7 诊断包 / 日志目录 — 动词与 preload diagnostics.* API 对齐，禁止 app: 域命名漂移）
  diagnosticsOpenLogsDir: 'diagnostics:openLogsDir',
  diagnosticsExportPackage: 'diagnostics:exportPackage',

  // 更新（M7 自动更新）
  updateStatus: 'update:status',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateChanged: 'update:changed',
} as const

export type ChannelName = (typeof CH)[keyof typeof CH]

/** 所有 R→M invoke 通道 */
export const INVOKE_CHANNELS = [
  CH.distrosList,
  CH.distrosStart,
  CH.distrosTerminate,
  CH.distrosShutdown,
  CH.distrosSetDefault,
  CH.distrosSetVersion,
  CH.distrosUnregister,
  CH.distrosInstall,
  CH.distrosListOnline,
  CH.distrosSetSparse,
  CH.distrosCompact,
  CH.distrosResize,
  CH.distrosSetDefaultUser,
  CH.ioExport,
  CH.ioImport,
  CH.ioMove,
  CH.ioClone,
  CH.ioListBackups,
  CH.ioCleanupBackups,
  CH.metaGet,
  CH.metaSet,
  CH.registryDetail,
  CH.configGet,
  CH.configSet,
  CH.configOpenExternal,
  CH.configResolveConflict,
  CH.wslconfRead,
  CH.wslconfWrite,
  CH.wslconfigRead,
  CH.wslconfigWrite,
  CH.clipboardRead,
  CH.clipboardWrite,
  CH.ptyCreate,
  CH.ptyInput,
  CH.ptyResize,
  CH.ptyKill,
  CH.ptyList,
  CH.ptyMaxSessions,
  CH.ptyHostInfo,
  CH.fsReadDir,
  CH.fsRead,
  CH.fsWrite,
  CH.fsRevealInExplorer,
  CH.metricsSample,
  CH.metricsOverview,
  CH.taskCancel,
  CH.actionRun,
  CH.networkStatus,
  CH.networkApply,
  CH.networkApplyAll,
  CH.networkRemove,
  CH.networkProxyApply,
  CH.networkProxyClear,
  CH.networkProxyState,
  CH.devicesStatus,
  CH.devicesList,
  CH.devicesBind,
  CH.devicesUnbind,
  CH.devicesAttach,
  CH.devicesDetach,
  CH.appGetVersion,
  CH.appOpenConfigDir,
  CH.appGetWslVersion,
  CH.appWslEnv,
  CH.appWslUpdate,
  CH.appWslSetDefaultVersion,
  CH.appPickDirectory,
  CH.appPickSaveFile,
  CH.appPickOpenFile,
  CH.appOpenPath,
  CH.appOpenExternal,
  CH.diagnosticsOpenLogsDir,
  CH.diagnosticsExportPackage,
  CH.appSignatureStatus,
  CH.updateStatus,
  CH.updateCheck,
  CH.updateDownload,
  CH.updateInstall,
  CH.appWindowMinimize,
  CH.appWindowMaximize,
  CH.appWindowClose,
] as const satisfies readonly ChannelName[]

/** 所有 M→R 事件通道 */
export const EVENT_CHANNELS = [
  CH.ptyData,
  CH.ptyExit,
  CH.taskProgress,
  CH.configChanged,
  CH.configConflict,
  CH.appNavigate,
  CH.updateChanged,
] as const
