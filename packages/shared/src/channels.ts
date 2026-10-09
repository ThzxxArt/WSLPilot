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

  // network
  networkApply: 'network:apply',

  // app
  appGetVersion: 'app:getVersion',
  appOpenConfigDir: 'app:openConfigDir',
  appWindowMinimize: 'app:windowMinimize',
  appWindowMaximize: 'app:windowMaximize',
  appWindowClose: 'app:windowClose',
  appNavigate: 'app:navigate',
  appGetWslVersion: 'app:getWslVersion',
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
  CH.fsReadDir,
  CH.fsRead,
  CH.fsWrite,
  CH.fsRevealInExplorer,
  CH.metricsSample,
  CH.taskCancel,
  CH.actionRun,
  CH.networkApply,
  CH.appGetVersion,
  CH.appOpenConfigDir,
  CH.appGetWslVersion,
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
] as const
