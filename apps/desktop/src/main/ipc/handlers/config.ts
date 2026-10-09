import { CH, type ConfigKey, type ConfigMap } from '@wslpilot/shared'
import type { ConfigConflictAction, DeepPartial } from '../../services/config-service'
import type { IpcContext } from '../router'

type AddFn = (
  channel: string,
  handler: (ctx: IpcContext, ...args: any[]) => Promise<unknown> | unknown,
) => void

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

  add(
    CH.configResolveConflict,
    async (c, payload: { fileKey: string; action: ConfigConflictAction }) => {
      const key = assertConfigKey(payload?.fileKey)
      const action = payload?.action
      if (action !== 'reload' && action !== 'overwrite' && action !== 'ignore') {
        throw new Error(`无效的冲突处理动作: ${action}`)
      }
      return c.configService.resolveConflict(key, action)
    },
  )

  // 启动时挂载变更监听，广播给所有窗口
  for (const key of CONFIG_KEYS) {
    ctx.configService.onChange(key, () => {
      const win = ctx.getMainWindow()
      win?.webContents.send(CH.configChanged, { fileKey: key })
      const conflict = ctx.configService.getConflict(key)
      if (conflict) {
        win?.webContents.send(CH.configConflict, conflict)
      }
    })
  }
}
