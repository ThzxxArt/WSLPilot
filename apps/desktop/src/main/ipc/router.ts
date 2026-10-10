import type { IpcMain } from 'electron'
import {
  CH,
  serializeIpcError,
  createAppError,
  parseIpcArgs,
  type ConfigKey,
} from '@wslpilot/shared'
import type { Logger } from '@wslpilot/kit'
import type { ConfigService, ConfigConflictAction } from '../services/config-service'
import type { WslService } from '../services/wsl-service'
import type { RegistryService } from '../services/registry-service'
import type { PtyManager } from '../services/pty-manager'
import type { IoService } from '../services/io-service'
import type { TaskRunner } from '../services/task-runner'
import type { WslConfService } from '../services/wslconf-service'
import type { ActionRunner } from '../services/action-runner'
import type { FsBridge } from '../services/fs-bridge'
import type { NetworkService } from '../services/network-service'
import type { UsbipdService } from '../services/usbipd-service'
import { registerConfigHandlers } from './handlers/config'
import { registerAppHandlers } from './handlers/app'
import { registerDistroHandlers } from './handlers/distros'
import { registerMetaHandlers } from './handlers/meta'
import { registerPtyHandlers } from './handlers/pty'
import { registerIoHandlers } from './handlers/io'
import { registerWslConfHandlers } from './handlers/wslconf'
import { registerActionHandlers } from './handlers/actions'
import { registerFsHandlers } from './handlers/fs'
import { registerNetworkHandlers } from './handlers/network'
import { registerDeviceHandlers } from './handlers/devices'

export interface IpcContext {
  configService: ConfigService
  logger: Logger
  getMainWindow: () => Electron.BrowserWindow | null
  wsl?: WslService
  registry?: RegistryService
  pty?: PtyManager
  io?: IoService
  tasks?: TaskRunner
}

export { serializeIpcError, deserializeIpcError, toAppError } from '@wslpilot/shared'

type Handler = (ctx: IpcContext, arg: never) => unknown

export function registerIpcHandlers(
  ipcMain: IpcMain,
  ctx: IpcContext,
  deps: {
    wsl: WslService
    registry: RegistryService
    pty: PtyManager
    io: IoService
    tasks: TaskRunner
    wslconf: WslConfService
    runner: ActionRunner
    fsBridge: FsBridge
    network: NetworkService
    devices: UsbipdService
  },
): void {
  const routes = new Map<string, Handler>()

  const add = (channel: string, handler: Handler) => routes.set(channel, handler)

  registerConfigHandlers(add, ctx)
  registerAppHandlers(add, ctx)
  registerDistroHandlers(add, ctx, deps)
  registerMetaHandlers(add)
  registerPtyHandlers(add, deps)
  registerIoHandlers(add, deps)
  registerWslConfHandlers(add, deps)
  registerActionHandlers(add, deps)
  registerFsHandlers(add, deps)
  registerNetworkHandlers(add, deps)
  registerDeviceHandlers(add, deps)

  for (const [channel, handler] of routes) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        ctx.logger.debug('ipc invoke', { channel })
        // 设计书 §8.2：入参 zod 校验，失败抛结构化错误
        let validated: unknown = args[0]
        try {
          validated = parseIpcArgs(channel, args)
        } catch (e) {
          throw createAppError('CONFIG_INVALID', {
            message: `参数校验失败：${channel}`,
            detail: e instanceof Error ? e.message : String(e),
          })
        }
        return await handler(ctx, validated as never)
      } catch (e) {
        const err = serializeIpcError(e)
        ctx.logger.error('ipc error', { channel, message: err.message.slice(0, 200) })
        throw err
      }
    })
  }

  ctx.logger.info('ipc handlers registered', { count: routes.size, channels: [...routes.keys()] })
}

export { CH }
export type { ConfigKey, ConfigConflictAction }
