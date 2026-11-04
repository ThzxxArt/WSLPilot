import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CH, CONFIG_FILE_NAMES } from '@wslpilot/shared'
import { registerConfigHandlers } from '../../src/main/ipc/handlers/config'
import type { IpcContext } from '../../src/main/ipc/router'

type Handler = (ctx: IpcContext, arg: unknown) => unknown

function setup(win: any = { isDestroyed: () => false, webContents: { send: vi.fn() } }) {
  const handlers = new Map<string, Handler>()
  const changed = new Map<string, () => void>()
  const configService = {
    load: vi.fn(async () => ({ ok: true })),
    patch: vi.fn(async () => ({ ok: true })),
    openInEditor: vi.fn(async () => {}),
    resolveConflict: vi.fn(async () => ({ ok: true })),
    onChange: vi.fn((key: string, cb: () => void) => {
      changed.set(key, cb)
      return () => {}
    }),
    getConflict: vi.fn(() => null),
  }
  const ctx = {
    configService,
    getMainWindow: () => win,
  } as unknown as IpcContext
  registerConfigHandlers(((ch: string, fn: Handler) => handlers.set(ch, fn)) as never, ctx)
  return { handlers, configService, changed, ctx }
}

describe('配置 IPC handlers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('config:get / set / openExternal 校验键名并透传', async () => {
    const { handlers, configService, ctx } = setup()
    await handlers.get(CH.configGet)!(ctx, 'settings')
    expect(configService.load).toHaveBeenCalledWith('settings')
    await handlers.get(CH.configSet)!(ctx, { fileKey: 'network', patch: { portForwarding: [] } })
    expect(configService.patch).toHaveBeenCalledWith('network', { portForwarding: [] })
    await handlers.get(CH.configOpenExternal)!(ctx, 'containers')
    expect(configService.openInEditor).toHaveBeenCalledWith('containers')
  })

  it('未知配置键 → CONFIG_INVALID（get/set/open/resolve 全覆盖）', async () => {
    const { handlers, ctx } = setup()
    for (const [ch, arg] of [
      [CH.configGet, 'nope'],
      [CH.configSet, { fileKey: 'nope', patch: {} }],
      [CH.configOpenExternal, 'nope'],
      [CH.configResolveConflict, { fileKey: 'nope', action: 'reload' }],
    ] as const) {
      await expect(handlers.get(ch)!(ctx, arg)).rejects.toMatchObject({
        code: 'CONFIG_INVALID',
      })
    }
  })

  it('冲突动作白名单：非法动作拒绝，合法动作透传', async () => {
    const { handlers, configService, ctx } = setup()
    await expect(
      handlers.get(CH.configResolveConflict)!(ctx, { fileKey: 'settings', action: 'destroy' }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    for (const action of ['reload', 'overwrite', 'ignore'] as const) {
      await handlers.get(CH.configResolveConflict)!(ctx, { fileKey: 'settings', action })
      expect(configService.resolveConflict).toHaveBeenLastCalledWith('settings', action)
    }
  })

  it('onChange 广播：窗口存活时发 changed；有冲突再发 conflict；窗口销毁/为空不发', async () => {
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    const { configService, changed } = setup(win)
    // 每个配置键都注册
    expect(changed.size).toBe(Object.keys(CONFIG_FILE_NAMES).length)

    changed.get('settings')!()
    expect(send).toHaveBeenCalledWith(CH.configChanged, { fileKey: 'settings' })

    configService.getConflict.mockReturnValueOnce({ fileKey: 'settings', external: true } as never)
    changed.get('settings')!()
    expect(send).toHaveBeenCalledWith(
      CH.configConflict,
      expect.objectContaining({ fileKey: 'settings' }),
    )

    const destroyed = { isDestroyed: () => true, webContents: { send: vi.fn() } }
    const s2 = setup(destroyed)
    s2.changed.get('settings')!()
    expect(destroyed.webContents.send).not.toHaveBeenCalled()

    const s3 = setup(null)
    s3.changed.get('settings')!()
  })
})

describe('config handler 缺省 payload 分支', () => {
  it('payload 缺失时抛 CONFIG_INVALID（不 TypeError）', async () => {
    const { handlers, ctx } = setup()
    await expect(handlers.get(CH.configSet)!(ctx, undefined)).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    })
    await expect(handlers.get(CH.configResolveConflict)!(ctx, undefined)).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    })
  })
})
