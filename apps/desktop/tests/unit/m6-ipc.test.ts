import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerNetworkHandlers } from '../../src/main/ipc/handlers/network'
import { registerDeviceHandlers } from '../../src/main/ipc/handlers/devices'
import { CH } from '@wslpilot/shared'

function makeCtx() {
  return {
    configService: {
      loadSync: vi.fn(() => ({ $schemaVersion: 1 })),
      load: vi.fn(async () => ({})),
    },
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLevel: vi.fn(),
    },
    getMainWindow: vi.fn(() => null),
  } as any
}

function collect(
  register: (add: any, deps: any) => void,
  deps: any,
): Map<string, (ctx: unknown, arg: unknown) => unknown> {
  const handlers = new Map<string, (ctx: unknown, arg: unknown) => unknown>()
  register((channel: string, handler: any) => handlers.set(channel, handler), deps)
  return handlers
}

function makeTasks() {
  return {
    start: vi.fn((opts: any) => {
      opts.run({
        taskId: 't',
        type: opts.type,
        report: vi.fn(),
        log: vi.fn(),
        isCanceled: () => false,
        throwIfCanceled: vi.fn(),
        onCancel: vi.fn(),
      })
      return { taskId: 't' }
    }),
    cancel: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    waitFor: vi.fn(),
    dispose: vi.fn(),
  } as any
}

describe('network handlers（M6）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('network:status 透传服务', async () => {
    const network = { status: vi.fn(async () => ({ mode: 'mirrored' })) }
    const handlers = collect(registerNetworkHandlers, {
      network,
      tasks: makeTasks(),
    })
    const out = await handlers.get(CH.networkStatus)!(makeCtx(), undefined)
    expect(out).toEqual({ mode: 'mirrored' })
  })

  it('network:apply 以 id 为白名单键启动长任务', async () => {
    const network = { applyRule: vi.fn(async () => {}) }
    const tasks = makeTasks()
    const handlers = collect(registerNetworkHandlers, { network, tasks })
    const handle = await handlers.get(CH.networkApply)!(makeCtx(), 'dev-3000')
    expect(handle).toEqual({ taskId: 't' })
    expect(tasks.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'network', lockKey: 'network:portproxy' }),
    )
    expect(network.applyRule).toHaveBeenCalledWith('dev-3000', expect.anything())
  })

  it('network:applyAll / network:remove 走串行锁', async () => {
    const network = { applyAll: vi.fn(async () => {}), removeRule: vi.fn(async () => {}) }
    const tasks = makeTasks()
    const handlers = collect(registerNetworkHandlers, { network, tasks })
    await handlers.get(CH.networkApplyAll)!(makeCtx(), undefined)
    await handlers.get(CH.networkRemove)!(makeCtx(), 'dev-3000')
    expect(network.applyAll).toHaveBeenCalled()
    expect(network.removeRule).toHaveBeenCalledWith('dev-3000', expect.anything())
    expect(tasks.start).toHaveBeenCalledTimes(2)
  })

  it('代理 apply / clear / state', async () => {
    const network = {
      proxyApply: vi.fn(async () => {}),
      proxyClear: vi.fn(async () => {}),
      proxyState: vi.fn(async () => ({
        path: '/etc/profile.d/wslpilot-proxy.sh',
        exists: true,
        content: 'x',
      })),
    }
    const handlers = collect(registerNetworkHandlers, { network, tasks: makeTasks() })
    expect(await handlers.get(CH.networkProxyApply)!(makeCtx(), { distro: 'Ubuntu' })).toEqual({
      distro: 'Ubuntu',
    })
    expect(await handlers.get(CH.networkProxyClear)!(makeCtx(), { distro: 'Ubuntu' })).toEqual({
      distro: 'Ubuntu',
    })
    expect(
      await handlers.get(CH.networkProxyState)!(makeCtx(), { distro: 'Ubuntu' }),
    ).toMatchObject({ exists: true })
    expect(network.proxyApply).toHaveBeenCalledWith('Ubuntu')
    expect(network.proxyClear).toHaveBeenCalledWith('Ubuntu')
  })
})

describe('devices handlers（M6 usbipd）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('devices:status / devices:list', async () => {
    const devices = {
      status: vi.fn(async () => ({ installed: true, version: '2.4.1' })),
      list: vi.fn(async () => [{ busId: '1-2' }]),
    }
    const handlers = collect(registerDeviceHandlers, { devices, tasks: makeTasks() })
    expect(await handlers.get(CH.devicesStatus)!(makeCtx(), undefined)).toEqual({
      installed: true,
      version: '2.4.1',
    })
    expect(await handlers.get(CH.devicesList)!(makeCtx(), undefined)).toHaveLength(1)
  })

  it('devices:bind / unbind 是长任务', async () => {
    const devices = { bind: vi.fn(async () => {}), unbind: vi.fn(async () => {}) }
    const tasks = makeTasks()
    const handlers = collect(registerDeviceHandlers, { devices, tasks })
    expect(await handlers.get(CH.devicesBind)!(makeCtx(), '1-2')).toEqual({ taskId: 't' })
    expect(await handlers.get(CH.devicesUnbind)!(makeCtx(), '1-2')).toEqual({ taskId: 't' })
    expect(devices.bind).toHaveBeenCalledWith('1-2', expect.anything())
    expect(devices.unbind).toHaveBeenCalledWith('1-2', expect.anything())
    expect(tasks.start).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'device', lockKey: 'usbipd' }),
    )
  })

  it('devices:attach / detach 直接执行', async () => {
    const devices = { attach: vi.fn(async () => {}), detach: vi.fn(async () => {}) }
    const handlers = collect(registerDeviceHandlers, { devices, tasks: makeTasks() })
    await handlers.get(CH.devicesAttach)!(makeCtx(), { busId: '1-2', distro: 'Ubuntu' })
    await handlers.get(CH.devicesDetach)!(makeCtx(), '1-2')
    expect(devices.attach).toHaveBeenCalledWith('1-2', 'Ubuntu')
    expect(devices.detach).toHaveBeenCalledWith('1-2')
  })
})
