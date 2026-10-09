import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CH, type AppSettings, type ConfigKey, type ConfigMap, type TaskProgress } from '@wslpilot/shared'

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
    onConflict: (
      cb: (payload: { fileKey: string; detail: string }) => void,
    ): (() => void) => {
      const h = (_e: IpcRendererEvent, p: { fileKey: string; detail: string }) => cb(p)
      ipcRenderer.on(CH.configConflict, h)
      return () => ipcRenderer.removeListener(CH.configConflict, h)
    },
  },

  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(CH.appGetVersion),
    openConfigDir: (): Promise<void> => ipcRenderer.invoke(CH.appOpenConfigDir),
    minimize: (): Promise<void> => ipcRenderer.invoke(CH.appWindowMinimize),
    maximize: (): Promise<void> => ipcRenderer.invoke(CH.appWindowMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(CH.appWindowClose),
    onNavigate: (cb: (path: string) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, path: string) => cb(path)
      ipcRenderer.on(CH.appNavigate, h)
      return () => ipcRenderer.removeListener(CH.appNavigate, h)
    },
  },

  // 预留：后续里程碑启用
  distros: {
    onProgress: (cb: (p: TaskProgress) => void): (() => void) => {
      const h = (_e: IpcRendererEvent, p: TaskProgress) => cb(p)
      ipcRenderer.on(CH.taskProgress, h)
      return () => ipcRenderer.removeListener(CH.taskProgress, h)
    },
  },
}

contextBridge.exposeInMainWorld('wslAPI', api)

export type WslApi = typeof api
export type { AppSettings, ConfigKey, ConfigMap }
