import { CH, type ConfigKey, type ConfigMap } from '@wslpilot/shared'
import type { IpcContext } from '../router'
import type { DeepPartial } from '../../services/config-service'

type AddFn = (channel: string, handler: (ctx: IpcContext, ...args: any[]) => Promise<unknown> | unknown) => void

const CONFIG_KEYS: ConfigKey[] = ['settings', 'distros', 'actions', 'network', 'uiState', 'state']

function assertConfigKey(key: string): ConfigKey {
  if (!CONFIG_KEYS.includes(key as ConfigKey)) {
    throw new Error(`未知配置键: ${key}`)
  }
  return key as ConfigKey
}

export function registerConfigHandlers(add: AddFn, ctx: IpcContext): void {
  add(CH.configGet, async (c, fileKey: string) => {
    const key = assertConfigKey(fileKey)
    return c.configService.load(key)
  })

  add(CH.configSet, async (c, payload: { fileKey: string; patch: DeepPartial<ConfigMap[ConfigKey]> }) => {
    const key = assertConfigKey(payload?.fileKey)
    return c.configService.patch(key, payload.patch as any)
  })

  add(CH.configOpenExternal, async (c, fileKey: string) => {
    const key = assertConfigKey(fileKey)
    await c.configService.openInEditor(key)
  })

  // 启动时挂载变更监听，广播给所有窗口
  for (const key of CONFIG_KEYS) {
    ctx.configService.onChange(key, () => {
      const win = ctx.getMainWindow()
      win?.webContents.send(CH.configChanged, { fileKey: key })
    })
  }
}
