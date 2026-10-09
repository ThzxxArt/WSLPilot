import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  CH,
  type AppSettings,
  type ConfigKey,
  type ConfigMap,
  type DistroMeta,
  type DistroView,
  type Metrics,
  type OverviewMetrics,
  type TaskProgress,
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
    ): Promise<ConfigMap[ConfigKey]> => ipcRenderer.invoke(CH.configResolveConflict, { fileKey, action }),
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
    registryDetail: (name: string): Promise<Partial<DistroView>> =>
      ipcRenderer.invoke(CH.registryDetail, name),
  },

  meta: {
    get: (name: string): Promise<DistroMeta | null> => ipcRenderer.invoke(CH.metaGet, name),
    set: (meta: DistroMeta): Promise<DistroMeta> => ipcRenderer.invoke(CH.metaSet, meta),
  },

  metrics: {
    /** 单个发行版指标 */
    sample: (name: string): Promise<Metrics> => ipcRenderer.invoke(CH.metricsSample, name),
    /** 全局概览指标 */
    sampleOverview: (): Promise<OverviewMetrics> =>
      ipcRenderer.invoke(CH.metricsSample, '*'),
    onProgress: (cb: (p: TaskProgress) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, p: TaskProgress) => cb(p)
      ipcRenderer.on(CH.taskProgress, h)
      return () => ipcRenderer.removeListener(CH.taskProgress, h)
    },
  },

  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(CH.appGetVersion),
    openConfigDir: (): Promise<void> => ipcRenderer.invoke(CH.appOpenConfigDir),
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
export type { AppSettings, ConfigKey, ConfigMap, DistroView, DistroMeta, Metrics, OverviewMetrics }
