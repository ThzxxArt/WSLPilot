import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CH } from '@wslpilot/shared'
import { registerContainerHandlers } from '../../src/main/ipc/handlers/containers'
import type { IpcContext } from '../../src/main/ipc/router'

type Handler = (ctx: IpcContext, arg: unknown) => unknown

function setup() {
  const handlers = new Map<string, Handler>()
  const add = (ch: string, fn: Handler) => handlers.set(ch, fn as Handler)
  const tasks = {
    start: vi.fn((opts: { run: (ctl: unknown) => Promise<void> }) => {
      const ctl = { report: vi.fn(), log: vi.fn() }
      void opts.run(ctl)
      return { taskId: 't1' }
    }),
  }
  const names = [
    'systemInfo',
    'sessionList',
    'sessionTerminate',
    'listContainers',
    'inspectContainer',
    'runContainer',
    'startContainer',
    'stopContainer',
    'restartContainer',
    'removeContainer',
    'pruneContainers',
    'logs',
    'stats',
    'copy',
    'listImages',
    'pullImage',
    'buildImage',
    'removeImage',
    'pruneImages',
    'listNetworks',
    'createNetwork',
    'removeNetwork',
    'connectNetwork',
    'disconnectNetwork',
    'pruneNetworks',
    'listVolumes',
    'createVolume',
    'removeVolume',
    'pruneVolumes',
    'readSettings',
    'writeSettings',
    'resetSettings',
  ]
  const wslc: Record<string, ReturnType<typeof vi.fn>> = {
    capabilities: vi.fn(async () => ({ installed: true })),
  }
  for (const n of names) wslc[n] = vi.fn(async () => undefined)
  registerContainerHandlers(add as never, { wslc: wslc as never, tasks: tasks as never })
  return { handlers, tasks, wslc }
}

const ctx = {} as IpcContext

describe('容器 IPC handlers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('无参查询直连服务', async () => {
    const { handlers, wslc } = setup()
    await handlers.get(CH.wslcStatus)!(ctx, { force: true })
    expect(wslc.capabilities).toHaveBeenCalledWith(true)
    await handlers.get(CH.wslcStatus)!(ctx, undefined)
    expect(wslc.capabilities).toHaveBeenLastCalledWith(false)
    await handlers.get(CH.containersList)!(ctx, undefined)
    expect(wslc.listContainers).toHaveBeenCalled()
    await handlers.get(CH.containersStats)!(ctx, undefined)
    expect(wslc.stats).toHaveBeenCalled()
    await handlers.get(CH.wslcSystemInfo)!(ctx, undefined)
    expect(wslc.systemInfo).toHaveBeenCalled()
    await handlers.get(CH.wslcSessionList)!(ctx, undefined)
    expect(wslc.sessionList).toHaveBeenCalled()
    await handlers.get(CH.imagesList)!(ctx, undefined)
    expect(wslc.listImages).toHaveBeenCalled()
    await handlers.get(CH.networksList)!(ctx, undefined)
    expect(wslc.listNetworks).toHaveBeenCalled()
    await handlers.get(CH.volumesList)!(ctx, undefined)
    expect(wslc.listVolumes).toHaveBeenCalled()
  })

  it('带参查询：inspect / copy / settings / 网络卷创建', async () => {
    const { handlers, wslc } = setup()
    await handlers.get(CH.containersInspect)!(ctx, 'web')
    expect(wslc.inspectContainer).toHaveBeenCalledWith('web')
    await handlers.get(CH.containersCopy)!(ctx, { src: 'D:\\a', dst: 'web:/b' })
    expect(wslc.copy).toHaveBeenCalledWith('D:\\a', 'web:/b')
    await handlers.get(CH.wslcSettingsWrite)!(ctx, { content: 'session: {}\n' })
    expect(wslc.writeSettings).toHaveBeenCalledWith('session: {}\n')
    await handlers.get(CH.wslcSettingsReset)!(ctx, undefined)
    expect(wslc.resetSettings).toHaveBeenCalled()
    await handlers.get(CH.networksCreate)!(ctx, { name: 'net', driver: 'bridge' })
    expect(wslc.createNetwork).toHaveBeenCalledWith('net', { driver: 'bridge' })
    await handlers.get(CH.networksRemove)!(ctx, 'net')
    expect(wslc.removeNetwork).toHaveBeenCalledWith('net')
    await handlers.get(CH.networksConnect)!(ctx, { network: 'net', container: 'web' })
    expect(wslc.connectNetwork).toHaveBeenCalledWith('net', 'web')
    await handlers.get(CH.networksDisconnect)!(ctx, { network: 'net', container: 'web' })
    expect(wslc.disconnectNetwork).toHaveBeenCalledWith('net', 'web')
    await handlers.get(CH.volumesCreate)!(ctx, 'vol')
    expect(wslc.createVolume).toHaveBeenCalledWith('vol')
    await handlers.get(CH.volumesRemove)!(ctx, 'vol')
    expect(wslc.removeVolume).toHaveBeenCalledWith('vol')
    await handlers.get(CH.imagesRemove)!(ctx, 'nginx:latest')
    expect(wslc.removeImage).toHaveBeenCalledWith('nginx:latest')
  })

  it('任务型通道：登记正确 type 并调用服务', async () => {
    const { handlers, tasks, wslc } = setup()
    handlers.get(CH.containersRun)!(ctx, {
      image: 'nginx:latest',
      ports: [],
      mounts: [],
      env: {},
      detach: true,
      rm: false,
    })
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'container-run', lockKey: 'wslc:container:nginx:latest' }),
    )

    handlers.get(CH.containersStart)!(ctx, 'web')
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'container-start', lockKey: 'wslc:container:web' }),
    )
    handlers.get(CH.containersStop)!(ctx, { id: 'web', timeoutSec: 5 })
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'container-stop' }),
    )
    handlers.get(CH.containersRestart)!(ctx, 'web')
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'container-restart' }),
    )
    handlers.get(CH.containersRemove)!(ctx, { id: 'web', force: true })
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'container-remove' }),
    )
    handlers.get(CH.containersPrune)!(ctx, undefined)
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'container-prune' }),
    )
    handlers.get(CH.containersLogs)!(ctx, { id: 'web', follow: true })
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'container-logs' }),
    )
    handlers.get(CH.imagesPull)!(ctx, 'nginx:latest')
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'image-pull', lockKey: 'wslc:image:nginx:latest' }),
    )
    handlers.get(CH.imagesBuild)!(ctx, { tag: 'app:dev', context: 'D:\\ctx' })
    expect(tasks.start).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'image-build' }))
    handlers.get(CH.imagesPrune)!(ctx, { all: true })
    expect(tasks.start).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'image-prune' }))
    handlers.get(CH.networksPrune)!(ctx, undefined)
    expect(tasks.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'network-remove' }),
    )
    handlers.get(CH.volumesPrune)!(ctx, undefined)
    expect(tasks.start).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'volume-remove' }))
    handlers.get(CH.wslcSessionTerminate)!(ctx, undefined)
    expect(tasks.start).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'wslc-session' }))

    // 让 tasks.start 的 run 回调完成一次，覆盖实际服务调用
    await vi.waitFor(() => expect(wslc.runContainer).toHaveBeenCalled())
    expect(wslc.runContainer).toHaveBeenCalledWith(
      expect.objectContaining({ image: 'nginx:latest' }),
      expect.anything(),
    )
  })

  it('settings 读取返回原始内容', async () => {
    const { handlers, wslc } = setup()
    wslc.readSettings.mockResolvedValue({ path: 'p', exists: true, content: 'x', model: {} })
    await expect(handlers.get(CH.wslcSettingsRead)!(ctx, undefined)).resolves.toMatchObject({
      path: 'p',
    })
  })
})
