import type { IpcMain } from 'electron'
import {
  CH,
  serializeIpcError,
  type ConfigKey,
} from '@wslpilot/shared'
import type { Logger } from '@wslpilot/kit'
import type { ConfigService, ConfigConflictAction } from '../services/config-service'
import { registerConfigHandlers } from './handlers/config'
import { registerAppHandlers } from './handlers/app'

export interface IpcContext {
  configService: ConfigService
  logger: Logger
  getMainWindow: () => Electron.BrowserWindow | null
}

export { serializeIpcError, deserializeIpcError, toAppError } from '@wslpilot/shared'

type Handler = (ctx: IpcContext, ...args: any[]) => Promise<unknown> | unknown

export function registerIpcHandlers(ipcMain: IpcMain, ctx: IpcContext): void {
  const routes = new Map<string, Handler>()

  const add = (channel: string, handler: Handler) => routes.set(channel, handler)

  registerConfigHandlers(add, ctx)
  registerAppHandlers(add, ctx)

  for (const [channel, handler] of routes) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        ctx.logger.debug('ipc invoke', { channel })
        return await handler(ctx, ...args)
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
