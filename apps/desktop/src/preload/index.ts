import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  CH,
  type AppSettings,
  type BackupFileInfo,
  type ConfigKey,
  type ConfigMap,
  type DirEntry,
  type DistroMeta,
  type DistroView,
  type FileFilter,
  type FsReadResult,
  type IoExportRequest,
  type IoImportRequest,
  type IoMoveRequest,
  type Metrics,
  type OverviewMetrics,
  type RegistryDetail,
  type TaskHandle,
  type TaskProgress,
  type WslAction,
} from '@wslpilot/shared'

/** 类型化窄接口 — 渲染进程唯一外部边界 */
const api = {
  config: {
    get: <K extends ConfigKey>(fileKey: K): Promise<ConfigMap[K]> =>
      ipcRenderer.invoke(CH.configGet, fileKey),
    set: <K extends ConfigKey>(fileKey: K, patch: unknown): Promise<ConfigMap[K]> =>
      ipcRenderer.invoke(CH.configSet, { fileKey, patch }),
    openExternal: (fileKey: ConfigKey): Promise<void> =>
      ipcRenderer.invoke(CH.configOpenExternal, fileKey),
    resolveConflict: (
      fileKey: ConfigKey,
      action: 'reload' | 'overwrite' | 'ignore',
    ): Promise<ConfigMap[ConfigKey]> =>
      ipcRenderer.invoke(CH.configResolveConflict, { fileKey, action }),
    onChanged: (cb: (payload: { fileKey: string }) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, p: { fileKey: string }) => cb(p)
      ipcRenderer.on(CH.configChanged, h)
      return () => ipcRenderer.removeListener(CH.configChanged, h)
    },
    onConflict: (cb: (payload: { fileKey: string; detail: string }) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, p: { fileKey: string; detail: string }) => cb(p)
      ipcRenderer.on(CH.configConflict, h)
      return () => ipcRenderer.removeListener(CH.configConflict, h)
    },
  },

  distros: {
    list: (): Promise<DistroView[]> => ipcRenderer.invoke(CH.distrosList),
    start: (name: string): Promise<void> => ipcRenderer.invoke(CH.distrosStart, name),
    terminate: (name: string): Promise<void> => ipcRenderer.invoke(CH.distrosTerminate, name),
    shutdown: (): Promise<void> => ipcRenderer.invoke(CH.distrosShutdown),
    setDefault: (name: string): Promise<void> => ipcRenderer.invoke(CH.distrosSetDefault, name),
    registryDetail: (name: string): Promise<RegistryDetail | null> =>
      ipcRenderer.invoke(CH.registryDetail, name),
    listOnline: (): Promise<string[]> => ipcRenderer.invoke(CH.distrosListOnline),
    install: (name?: string): Promise<TaskHandle> =>
      ipcRenderer.invoke(CH.distrosInstall, name ? { name } : {}),
    setVersion: (name: string, version: 1 | 2): Promise<TaskHandle> =>
      ipcRenderer.invoke(CH.distrosSetVersion, { name, version }),
    uninstall: (name: string): Promise<void> => ipcRenderer.invoke(CH.distrosUnregister, name),
  },

  meta: {
    get: (name: string): Promise<DistroMeta | null> => ipcRenderer.invoke(CH.metaGet, name),
    set: (meta: DistroMeta): Promise<DistroMeta> => ipcRenderer.invoke(CH.metaSet, meta),
  },

  metrics: {
    /** 单个发行版指标 */
    sample: (name: string): Promise<Metrics> => ipcRenderer.invoke(CH.metricsSample, name),
    /** 全局概览指标 */
    sampleOverview: (): Promise<OverviewMetrics> => ipcRenderer.invoke(CH.metricsSample, '*'),
  },

  terminal: {
    create: (opts: {
      distro: string
      shell?: string
      cwd?: string
      cols: number
      rows: number
    }): Promise<{ ptyId: string; distro: string; shell: string; createdAt: number }> =>
      ipcRenderer.invoke(CH.ptyCreate, opts),
    input: (ptyId: string, data: string): Promise<void> =>
      ipcRenderer.invoke(CH.ptyInput, { ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(CH.ptyResize, { ptyId, cols, rows }),
    kill: (ptyId: string): Promise<void> => ipcRenderer.invoke(CH.ptyKill, ptyId),
    list: (): Promise<{ ptyId: string; distro: string; shell: string }[]> =>
      ipcRenderer.invoke(CH.ptyList),
    maxSessions: (): Promise<number> => ipcRenderer.invoke(CH.ptyMaxSessions),
    onData: (cb: (p: { ptyId: string; chunk: string }) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, p: { ptyId: string; chunk: string }) => cb(p)
      ipcRenderer.on(CH.ptyData, h)
      return () => ipcRenderer.removeListener(CH.ptyData, h)
    },
    onExit: (cb: (p: { ptyId: string; code: number }) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, p: { ptyId: string; code: number }) => cb(p)
      ipcRenderer.on(CH.ptyExit, h)
      return () => ipcRenderer.removeListener(CH.ptyExit, h)
    },
  },

  io: {
    export: (req: IoExportRequest): Promise<TaskHandle> => ipcRenderer.invoke(CH.ioExport, req),
    import: (req: IoImportRequest): Promise<TaskHandle> => ipcRenderer.invoke(CH.ioImport, req),
    move: (req: IoMoveRequest): Promise<TaskHandle> => ipcRenderer.invoke(CH.ioMove, req),
    listBackups: (dir?: string): Promise<BackupFileInfo[]> =>
      ipcRenderer.invoke(CH.ioListBackups, dir ? { dir } : {}),
    cleanupBackups: (opts: { dir?: string; keep: number }): Promise<{ removed: number }> =>
      ipcRenderer.invoke(CH.ioCleanupBackups, opts ?? { keep: 5 }),
  },

  wslconf: {
    /** 读 /etc/wsl.conf 原文（文件不存在返回空串） */
    read: (name: string): Promise<string> => ipcRenderer.invoke(CH.wslconfRead, name),
    /** 写 /etc/wsl.conf（发行版内 root）；返回是否按设置自动终止了发行版 */
    write: (name: string, content: string): Promise<{ terminated: boolean }> =>
      ipcRenderer.invoke(CH.wslconfWrite, { name, content }),
  },

  actions: {
    /** 执行 actions.jsonc 白名单动作；terminal 动作附带 ptyId */
    run: (actionId: string, distro?: string): Promise<TaskHandle> =>
      ipcRenderer.invoke(CH.actionRun, distro ? { actionId, distro } : { actionId }),
    /** 动作清单（读 actions.jsonc）；异常形状降级为空列表 */
    list: (): Promise<WslAction[]> =>
      ipcRenderer
        .invoke(CH.configGet, 'actions')
        .then((f: { actions?: WslAction[] } | null) =>
          Array.isArray(f?.actions) ? f.actions : [],
        ),
    /** 写回动作清单（整表替换） */
    save: (actions: WslAction[]): Promise<unknown> =>
      ipcRenderer.invoke(CH.configSet, { fileKey: 'actions', patch: { actions } }),
  },

  fs: {
    readDir: (distro: string, path: string): Promise<DirEntry[]> =>
      ipcRenderer.invoke(CH.fsReadDir, { distro, path }),
    read: (distro: string, path: string): Promise<FsReadResult> =>
      ipcRenderer.invoke(CH.fsRead, { distro, path }),
    write: (distro: string, path: string, data: string): Promise<void> =>
      ipcRenderer.invoke(CH.fsWrite, { distro, path, data }),
    revealInExplorer: (distro: string, path: string): Promise<void> =>
      ipcRenderer.invoke(CH.fsRevealInExplorer, { distro, path }),
  },

  task: {
    cancel: (taskId: string): Promise<boolean> => ipcRenderer.invoke(CH.taskCancel, taskId),
    onProgress: (cb: (p: TaskProgress) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, p: TaskProgress) => cb(p)
      ipcRenderer.on(CH.taskProgress, h)
      return () => ipcRenderer.removeListener(CH.taskProgress, h)
    },
  },

  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(CH.appGetVersion),
    openConfigDir: (): Promise<void> => ipcRenderer.invoke(CH.appOpenConfigDir),
    openPath: (target: string): Promise<void> => ipcRenderer.invoke(CH.appOpenPath, target),
    pickDirectory: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke(CH.appPickDirectory, defaultPath ? { defaultPath } : {}),
    pickSaveFile: (opts: {
      defaultPath?: string
      suggestedName?: string
      filters?: FileFilter[]
    }): Promise<string | null> => ipcRenderer.invoke(CH.appPickSaveFile, opts ?? {}),
    pickOpenFile: (opts: {
      defaultPath?: string
      filters?: FileFilter[]
    }): Promise<string | null> => ipcRenderer.invoke(CH.appPickOpenFile, opts ?? {}),
    getWslVersion: (): Promise<{ wslVersion: string; kernelVersion: string; raw: string }> =>
      ipcRenderer.invoke(CH.appGetWslVersion),
    minimize: (): Promise<void> => ipcRenderer.invoke(CH.appWindowMinimize),
    maximize: (): Promise<void> => ipcRenderer.invoke(CH.appWindowMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(CH.appWindowClose),
    onNavigate: (cb: (path: string) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, path: string) => cb(path)
      ipcRenderer.on(CH.appNavigate, h)
      return () => ipcRenderer.removeListener(CH.appNavigate, h)
    },
  },
}

contextBridge.exposeInMainWorld('wslAPI', api)

export type WslApi = typeof api
export type {
  AppSettings,
  ConfigKey,
  ConfigMap,
  DistroView,
  DistroMeta,
  Metrics,
  OverviewMetrics,
  TaskHandle,
  TaskProgress,
  BackupFileInfo,
  RegistryDetail,
  WslAction,
  DirEntry,
  FsReadResult,
}
