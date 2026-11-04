import { CH, type ContainerRunSpec, type TaskHandle } from '@wslpilot/shared'
import type { WslcService } from '../../services/wslc-service'
import type { TaskRunner } from '../../services/task-runner'
import type { IpcContext } from '../router'

type AddFn = (channel: string, handler: (ctx: IpcContext, arg: never) => unknown) => void

export interface ContainerHandlerDeps {
  wslc: WslcService
  tasks: TaskRunner
}

export function registerContainerHandlers(add: AddFn, deps: ContainerHandlerDeps): void {
  const { wslc, tasks } = deps

  add(CH.wslcStatus, async (_c, arg: never) => {
    const o = (arg ?? {}) as { force?: boolean }
    return wslc.capabilities(o.force === true)
  })
  add(CH.wslcSystemInfo, async () => wslc.systemInfo())
  add(CH.wslcSessionList, async () => wslc.sessionList())
  add(CH.wslcSessionTerminate, (): TaskHandle =>
    tasks.start({
      type: 'wslc-session',
      message: '终止 wslc 容器会话',
      lockKey: 'wslc:session',
      run: (ctl) => wslc.sessionTerminate(ctl),
    }),
  )
  add(CH.wslcSettingsRead, async () => wslc.readSettings())
  add(CH.wslcSettingsWrite, async (_c, arg: never) => {
    const o = arg as { content: string }
    return wslc.writeSettings(o.content)
  })
  add(CH.wslcSettingsReset, async () => wslc.resetSettings())

  add(CH.containersList, async () => wslc.listContainers())
  add(CH.containersInspect, async (_c, arg: never) => wslc.inspectContainer(String(arg)))
  add(CH.containersStats, async () => wslc.stats())
  add(CH.containersRun, (_c, arg: never): TaskHandle => {
    const spec = arg as ContainerRunSpec
    return tasks.start({
      type: 'container-run',
      message: `运行容器 ${spec.name ?? spec.image}`,
      lockKey: `wslc:container:${spec.name ?? spec.image}`,
      run: (ctl) => wslc.runContainer(spec, ctl),
    })
  })
  add(CH.containersStart, (_c, arg: never): TaskHandle => {
    const id = String(arg)
    return tasks.start({
      type: 'container-start',
      message: `启动容器 ${id}`,
      lockKey: `wslc:container:${id}`,
      run: async () => wslc.startContainer(id),
    })
  })
  add(CH.containersStop, (_c, arg: never): TaskHandle => {
    const o = arg as { id: string; timeoutSec?: number }
    return tasks.start({
      type: 'container-stop',
      message: `停止容器 ${o.id}`,
      lockKey: `wslc:container:${o.id}`,
      run: async () => wslc.stopContainer(o.id, o.timeoutSec),
    })
  })
  add(CH.containersRestart, (_c, arg: never): TaskHandle => {
    const id = String(arg)
    return tasks.start({
      type: 'container-restart',
      message: `重启容器 ${id}`,
      lockKey: `wslc:container:${id}`,
      run: async () => wslc.restartContainer(id),
    })
  })
  add(CH.containersRemove, (_c, arg: never): TaskHandle => {
    const o = arg as { id: string; force: boolean }
    return tasks.start({
      type: 'container-remove',
      message: `删除容器 ${o.id}`,
      lockKey: `wslc:container:${o.id}`,
      run: (ctl) => wslc.removeContainer(o.id, o.force, ctl),
    })
  })
  add(CH.containersPrune, (): TaskHandle =>
    tasks.start({
      type: 'container-prune',
      message: '清理已停止容器',
      lockKey: 'wslc:session',
      run: (ctl) => wslc.pruneContainers(ctl),
    }),
  )
  add(CH.containersLogs, (_c, arg: never): TaskHandle => {
    const o = arg as { id: string; follow: boolean }
    return tasks.start({
      type: 'container-logs',
      message: `读取容器 ${o.id} 日志`,
      run: (ctl) => wslc.logs(o.id, ctl, o.follow),
    })
  })
  add(CH.containersCopy, async (_c, arg: never) => {
    const o = arg as { src: string; dst: string }
    await wslc.copy(o.src, o.dst)
  })

  add(CH.imagesList, async () => wslc.listImages())
  add(CH.imagesPull, (_c, arg: never): TaskHandle => {
    const ref = String(arg)
    return tasks.start({
      type: 'image-pull',
      message: `拉取镜像 ${ref}`,
      lockKey: `wslc:image:${ref}`,
      run: (ctl) => wslc.pullImage(ref, ctl),
    })
  })
  add(CH.imagesBuild, (_c, arg: never): TaskHandle => {
    const o = arg as { tag: string; context: string }
    return tasks.start({
      type: 'image-build',
      message: `构建镜像 ${o.tag}`,
      lockKey: `wslc:image:${o.tag}`,
      run: (ctl) => wslc.buildImage(o.tag, o.context, ctl),
    })
  })
  add(CH.imagesRemove, async (_c, arg: never) => wslc.removeImage(String(arg)))
  add(CH.imagesPrune, (_c, arg: never): TaskHandle => {
    const o = arg as { all: boolean }
    return tasks.start({
      type: 'image-prune',
      message: '清理镜像',
      lockKey: 'wslc:session',
      run: (ctl) => wslc.pruneImages(o.all, ctl),
    })
  })

  add(CH.networksList, async () => wslc.listNetworks())
  add(CH.networksCreate, async (_c, arg: never) => {
    const o = arg as {
      name: string
      driver?: string
      subnet?: string
      gateway?: string
    }
    await wslc.createNetwork(o.name, {
      ...(o.driver ? { driver: o.driver } : {}),
      ...(o.subnet ? { subnet: o.subnet } : {}),
      ...(o.gateway ? { gateway: o.gateway } : {}),
    })
  })
  add(CH.networksRemove, async (_c, arg: never) => wslc.removeNetwork(String(arg)))
  add(CH.networksConnect, async (_c, arg: never) => {
    const o = arg as { network: string; container: string }
    await wslc.connectNetwork(o.network, o.container)
  })
  add(CH.networksDisconnect, async (_c, arg: never) => {
    const o = arg as { network: string; container: string }
    await wslc.disconnectNetwork(o.network, o.container)
  })
  add(CH.networksPrune, (): TaskHandle =>
    tasks.start({
      type: 'network-remove',
      message: '清理网络',
      lockKey: 'wslc:session',
      run: (ctl) => wslc.pruneNetworks(ctl),
    }),
  )

  add(CH.volumesList, async () => wslc.listVolumes())
  add(CH.volumesCreate, async (_c, arg: never) => wslc.createVolume(String(arg)))
  add(CH.volumesRemove, async (_c, arg: never) => wslc.removeVolume(String(arg)))
  add(CH.volumesPrune, (): TaskHandle =>
    tasks.start({
      type: 'volume-remove',
      message: '清理卷',
      lockKey: 'wslc:session',
      run: (ctl) => wslc.pruneVolumes(ctl),
    }),
  )
}
