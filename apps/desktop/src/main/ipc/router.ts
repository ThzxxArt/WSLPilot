import type { IpcMain } from 'electron'
import { CH, createAppError, type AppError } from '@wslpilot/shared'
import type { Logger } from '@wslpilot/kit'
import type { ConfigService } from '../services/config-service'
import { registerConfigHandlers } from './handlers/config'
import { registerAppHandlers } from './handlers/app'

export interface IpcContext {
  configService: ConfigService
  logger: Logger
  getMainWindow: () => Electron.BrowserWindow | null
}

/** 将错误序列化为 AppError，供渲染层消费 */
export function toIpcError(e: unknown): AppError {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    return e as AppError
  }
  return createAppError('UNKNOWN', { detail: String(e) }).toJSON()
}

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
        const err = toIpcError(e)
        ctx.logger.error('ipc error', { channel, code: err.code, message: err.message })
        // Electron invoke 会 reject；抛出可序列化对象
        throw err
      }
    })
  }

  ctx.logger.info('ipc handlers registered', { count: routes.size, channels: [...routes.keys()] })
}

export { CH }
