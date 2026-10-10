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

  // io
  ioExport: 'io:export',
  ioImport: 'io:import',
  ioMove: 'io:move',
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

  // wsl.conf
  wslconfRead: 'wslconf:read',
  wslconfWrite: 'wslconf:write',

  // pty
  ptyCreate: 'pty:create',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  ptyList: 'pty:list',
  ptyMaxSessions: 'pty:maxSessions',

  // fs
  fsReadDir: 'fs:readDir',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsRevealInExplorer: 'fs:revealInExplorer',

  // metrics / tasks
  metricsSample: 'metrics:sample',
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
  appPickDirectory: 'app:pickDirectory',
  appPickSaveFile: 'app:pickSaveFile',
  appPickOpenFile: 'app:pickOpenFile',
  appOpenPath: 'app:openPath',
  appOpenLogsDir: 'app:openLogsDir',
  appExportDiagnostics: 'app:exportDiagnostics',
  appSignatureStatus: 'app:signatureStatus',

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
  CH.ioExport,
  CH.ioImport,
  CH.ioMove,
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
  CH.ptyCreate,
  CH.ptyInput,
  CH.ptyResize,
  CH.ptyKill,
  CH.ptyList,
  CH.ptyMaxSessions,
  CH.fsReadDir,
  CH.fsRead,
  CH.fsWrite,
  CH.fsRevealInExplorer,
  CH.metricsSample,
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
  CH.appPickDirectory,
  CH.appPickSaveFile,
  CH.appPickOpenFile,
  CH.appOpenPath,
  CH.appOpenLogsDir,
  CH.appExportDiagnostics,
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
