import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createWslAPI } from '../component/support'

let wslAPI: ReturnType<typeof createWslAPI>
;(globalThis as any).window = { wslAPI: (wslAPI = createWslAPI()) }

const { useContainersStore } = await import('../../src/renderer/stores/containers')
const { useTasksStore } = await import('../../src/renderer/stores/tasks')

const container = {
  id: 'c1',
  name: 'web',
  image: 'nginx:latest',
  state: 'running' as const,
  status: 'Up',
  health: 'healthy' as const,
  ports: [],
  createdAt: '',
}

beforeEach(() => {
  setActivePinia(createPinia())
  wslAPI = createWslAPI()
  ;(globalThis as any).window = { wslAPI }
  vi.clearAllMocks()
})

describe('useContainersStore', () => {
  it('初始状态与 getter', () => {
    const s = useContainersStore()
    expect(s.installed).toBe(false)
    expect(s.running).toEqual([])
    expect(s.statsFor('c1')).toBeNull()
  })

  it('loadStatus 失败 → status null + lastError', async () => {
    wslAPI.containers.status.mockRejectedValue({
      code: 'TASK_FAILED',
      message: 'probe failed',
      recoverable: true,
    })
    const s = useContainersStore()
    await s.loadStatus()
    expect(s.status).toBeNull()
    expect(s.lastError?.message).toBe('probe failed')
  })

  it('loadAll：未安装时短路，不调用列表接口', async () => {
    wslAPI.containers.status.mockResolvedValue({ installed: false, version: '' })
    const s = useContainersStore()
    await s.loadAll()
    expect(s.installed).toBe(false)
    expect(wslAPI.containers.list).not.toHaveBeenCalled()
    expect(s.loading).toBe(false)
  })

  it('loadAll：成功装载容器/镜像/网络/卷/统计/系统/会话', async () => {
    wslAPI.containers.list.mockResolvedValue([container])
    wslAPI.images.list.mockResolvedValue([{ id: 'i1' }])
    wslAPI.networks.list.mockResolvedValue([{ id: 'n1', name: 'net' }])
    wslAPI.volumes.list.mockResolvedValue([{ name: 'v1' }])
    wslAPI.containers.stats.mockResolvedValue([{ containerId: 'c1', cpuPercent: 5 }])
    wslAPI.containers.systemInfo.mockResolvedValue({ version: '2.9.3' })
    wslAPI.containers.sessionList.mockResolvedValue([{ name: 'default', state: 'running' }])
    const s = useContainersStore()
    await s.loadAll()
    expect(s.installed).toBe(true)
    expect(s.containers).toHaveLength(1)
    expect(s.running).toHaveLength(1)
    expect(s.images).toHaveLength(1)
    expect(s.networks).toHaveLength(1)
    expect(s.volumes).toHaveLength(1)
    expect(s.statsFor('c1')?.cpuPercent).toBe(5)
    expect(s.system?.version).toBe('2.9.3')
    expect(s.sessions).toHaveLength(1)
  })

  it('loadAll：并发代际保护（旧请求晚到不覆盖新结果）', async () => {
    let resolveFirst!: (v: unknown[]) => void
    const first = new Promise<unknown[]>((r) => (resolveFirst = r))
    wslAPI.containers.list.mockReturnValueOnce(first as never).mockResolvedValueOnce([container])
    const s = useContainersStore()
    const p1 = s.loadAll()
    const p2 = s.loadAll()
    await p2
    expect(s.containers).toEqual([container])
    resolveFirst([{ ...container, id: 'old', name: 'old' }])
    await p1
    expect(s.containers).toEqual([container])
  })

  it('loadAll：列表失败 → lastError，loading 复位', async () => {
    wslAPI.containers.list.mockRejectedValue({
      code: 'TASK_FAILED',
      message: 'wslc down',
      recoverable: true,
    })
    const s = useContainersStore()
    await s.loadAll()
    expect(s.lastError?.message).toBe('wslc down')
    expect(s.loading).toBe(false)
  })

  it('loadContainers / refreshStats / reloadFromEvent', async () => {
    wslAPI.containers.list.mockResolvedValue([container])
    wslAPI.containers.stats.mockResolvedValue([{ containerId: 'c1', cpuPercent: 9 }])
    const s = useContainersStore()
    await s.loadContainers()
    expect(s.containers).toHaveLength(1)
    expect(s.statsFor('c1')?.cpuPercent).toBe(9)

    wslAPI.containers.stats.mockResolvedValue([{ containerId: 'c1', cpuPercent: 11 }])
    await s.refreshStats()
    expect(s.statsFor('c1')?.cpuPercent).toBe(11)

    await s.reloadFromEvent()
    expect(wslAPI.containers.list).toHaveBeenCalledTimes(2)
  })

  it('loadContainers 失败落地 lastError；refreshStats 失败向上抛由轮询吞掉', async () => {
    wslAPI.containers.list.mockRejectedValue({
      code: 'TASK_FAILED',
      message: 'x',
      recoverable: true,
    })
    wslAPI.containers.stats.mockRejectedValue({
      code: 'TASK_FAILED',
      message: 'stats',
      recoverable: true,
    })
    const s = useContainersStore()
    await s.loadContainers()
    expect(s.lastError?.message).toBe('x')
    await expect(s.refreshStats()).rejects.toBeTruthy()
  })

  it('生命周期动作：调用 API 并登记任务', async () => {
    const s = useContainersStore()
    const tasks = useTasksStore()
    const spec = {
      image: 'nginx:latest',
      ports: [],
      mounts: [],
      env: {},
      detach: true,
      rm: false,
    }
    await s.run(spec)
    await s.start('c1')
    await s.stop('c1', 5)
    await s.restart('c1')
    await s.remove('c1', true)
    await s.prune()
    await s.logs('c1', true)
    await s.pull('nginx:latest')
    await s.build('app:dev', 'D:\\ctx')
    await s.pruneImages(true)
    await s.terminateSession()

    expect(wslAPI.containers.run).toHaveBeenCalledWith(spec)
    expect(wslAPI.containers.stop).toHaveBeenCalledWith('c1', 5)
    expect(wslAPI.containers.remove).toHaveBeenCalledWith('c1', true)
    expect(wslAPI.images.prune).toHaveBeenCalledWith(true)
    expect(tasks.entries.map((e) => e.type)).toEqual([
      'container-run',
      'container-start',
      'container-stop',
      'container-restart',
      'container-remove',
      'container-prune',
      'container-logs',
      'image-pull',
      'image-build',
      'image-prune',
      'wslc-session',
    ])
  })

  it('生命周期动作失败：lastError 落地且向上抛（页面提示）', async () => {
    wslAPI.containers.start.mockRejectedValue({
      code: 'WSL_FEATURE_UNSUPPORTED',
      message: 'no wslc',
      recoverable: true,
    })
    const s = useContainersStore()
    await expect(s.start('c1')).rejects.toMatchObject({ message: 'no wslc' })
    expect(s.lastError?.message).toBe('no wslc')
  })

  it('镜像/网络/卷操作成功后刷新对应列表', async () => {
    wslAPI.images.list.mockResolvedValue([{ id: 'i2' }])
    wslAPI.networks.list.mockResolvedValue([{ id: 'n2', name: 'net2' }])
    wslAPI.volumes.list.mockResolvedValue([{ name: 'v2' }])
    const s = useContainersStore()

    await s.removeImage('nginx:latest')
    expect(s.images).toEqual([{ id: 'i2' }])

    await s.createNetwork({ name: 'net2' })
    expect(s.networks[0]).toMatchObject({ name: 'net2' })
    await s.removeNetwork('net2')
    expect(wslAPI.networks.remove).toHaveBeenCalledWith('net2')

    await s.createVolume('v2')
    expect(s.volumes[0]).toEqual({ name: 'v2' })
    await s.removeVolume('v2')
    expect(wslAPI.volumes.remove).toHaveBeenCalledWith('v2')
  })

  it('网络/卷操作失败 → lastError + 抛出', async () => {
    wslAPI.networks.create.mockRejectedValue({
      code: 'TASK_FAILED',
      message: 'n',
      recoverable: true,
    })
    wslAPI.volumes.create.mockRejectedValue({
      code: 'TASK_FAILED',
      message: 'v',
      recoverable: true,
    })
    const s = useContainersStore()
    await expect(s.createNetwork({ name: 'n' })).rejects.toMatchObject({ message: 'n' })
    expect(s.lastError?.message).toBe('n')
    await expect(s.createVolume('v')).rejects.toMatchObject({ message: 'v' })
    expect(s.lastError?.message).toBe('v')
  })

  it('settings 读取/保存/失败路径', async () => {
    const s = useContainersStore()
    await s.loadSettings()
    expect(s.settings?.content).toBe('')
    wslAPI.containers.settingsWrite.mockResolvedValue({ path: 'p' })
    await s.saveSettings('session: {}\n')
    expect(wslAPI.containers.settingsWrite).toHaveBeenCalledWith('session: {}\n')

    wslAPI.containers.settingsWrite.mockRejectedValue({
      code: 'CONFIG_INVALID',
      message: 'bad yaml',
      recoverable: true,
    })
    await expect(s.saveSettings('{')).rejects.toMatchObject({ message: 'bad yaml' })
    expect(s.lastError?.message).toBe('bad yaml')
  })
})

describe('containers store 剩余失败分支', () => {
  it('loadSettings 失败记录 lastError；terminateSession 失败抛出并记录', async () => {
    wslAPI.containers.settingsRead.mockRejectedValue({
      code: 'IO_ERROR',
      message: 'settings read',
      recoverable: true,
    })
    wslAPI.containers.sessionTerminate.mockRejectedValue({
      code: 'TASK_FAILED',
      message: 'session',
      recoverable: true,
    })
    const s = useContainersStore()
    await s.loadSettings()
    expect(s.lastError?.message).toBe('settings read')
    await expect(s.terminateSession()).rejects.toMatchObject({ message: 'session' })
    expect(s.lastError?.message).toBe('session')
  })
})

describe('containers store 所有动作失败分支', () => {
  it('run/stop/restart/remove/prune/logs/pull/build/pruneImages 失败均记录并抛出', async () => {
    const err = { code: 'TASK_FAILED', message: 'boom', recoverable: true }
    for (const fn of [
      wslAPI.containers.run,
      wslAPI.containers.stop,
      wslAPI.containers.restart,
      wslAPI.containers.remove,
      wslAPI.containers.prune,
      wslAPI.containers.logs,
      wslAPI.images.pull,
      wslAPI.images.build,
      wslAPI.images.prune,
    ]) {
      fn.mockRejectedValueOnce(err)
    }
    const s = useContainersStore()
    const spec = { image: 'ubuntu', ports: [], mounts: [], env: {}, detach: true, rm: false }
    const runs = [
      () => s.run(spec),
      () => s.stop('c1'),
      () => s.restart('c1'),
      () => s.remove('c1'),
      () => s.prune(),
      () => s.logs('c1'),
      () => s.pull('ubuntu'),
      () => s.build('a:1', 'D:\\ctx'),
      () => s.pruneImages(),
    ]
    for (const run of runs) {
      await expect(run()).rejects.toMatchObject({ message: 'boom' })
      expect(s.lastError?.message).toBe('boom')
    }
  })

  it('removeImage / removeNetwork / removeVolume / saveSettings 失败记录', async () => {
    const err = { code: 'TASK_FAILED', message: 'rm', recoverable: true }
    wslAPI.images.remove.mockRejectedValueOnce(err)
    wslAPI.networks.remove.mockRejectedValueOnce(err)
    wslAPI.volumes.remove.mockRejectedValueOnce(err)
    wslAPI.containers.settingsWrite.mockRejectedValueOnce(err)
    const s = useContainersStore()
    await expect(s.removeImage('i')).rejects.toMatchObject({ message: 'rm' })
    await expect(s.removeNetwork('n')).rejects.toMatchObject({ message: 'rm' })
    await expect(s.removeVolume('v')).rejects.toMatchObject({ message: 'rm' })
    await expect(s.saveSettings('x')).rejects.toMatchObject({ message: 'rm' })
    expect(s.lastError?.message).toBe('rm')
  })
})

describe('containers store getter 空数组分支', () => {
  it('installed 为 true 但列表为空时 running/statsFor 安全', async () => {
    wslAPI.containers.status.mockResolvedValue({ installed: true, version: '2.9.3' })
    const s = useContainersStore()
    await s.loadStatus()
    expect(s.installed).toBe(true)
    expect(s.running).toEqual([])
    expect(s.statsFor('none')).toBeNull()
  })
})

describe('containers run 带名称分支', () => {
  it('spec.name 存在时任务消息使用容器名', async () => {
    const s = useContainersStore()
    const handle = await s.run({
      image: 'nginx',
      name: 'web',
      ports: [],
      mounts: [],
      env: {},
      detach: true,
      rm: false,
    })
    expect(handle.taskId).toBe('c-run')
    expect(useTasksStore().entries.at(-1)?.message).toContain('web')
  })
})

describe('containers store：containers.jsonc 配方与最近镜像', () => {
  it('loadRecipes 读取合法配方；保存/删除/最近镜像落盘并去重', async () => {
    wslAPI.config.get.mockResolvedValueOnce({
      recipes: [{ id: 'web', label: 'Web', image: 'nginx:latest' }],
      recentImages: ['nginx:latest'],
    })
    const s = useContainersStore()
    await s.loadRecipes()
    expect(s.recipes).toHaveLength(1)
    expect(s.recentImages).toEqual(['nginx:latest'])

    await s.saveRecipe({
      id: 'web',
      label: 'Web2',
      image: 'nginx:1.27',
      ports: [],
      mounts: [],
      env: {},
      detach: true,
      rm: false,
    })
    expect(wslAPI.config.set).toHaveBeenCalledWith(
      'containers',
      expect.objectContaining({ recipes: [expect.objectContaining({ id: 'web' })] }),
    )
    expect(s.recipes[0]).toMatchObject({ label: 'Web2', image: 'nginx:1.27' })

    await s.deleteRecipe('web')
    expect(s.recipes).toEqual([])

    await s.rememberImage('alpine:3.20')
    await s.rememberImage('alpine:3.20')
    expect(s.recentImages[0]).toBe('alpine:3.20')
    expect(s.recentImages.filter((x) => x === 'alpine:3.20')).toHaveLength(1)
  })

  it('loadRecipes 失败记录 lastError；损坏形状降级为空', async () => {
    wslAPI.config.get.mockRejectedValueOnce({
      code: 'CONFIG_INVALID',
      message: 'bad containers',
      recoverable: true,
    })
    const s = useContainersStore()
    await s.loadRecipes()
    expect(s.lastError?.message).toBe('bad containers')

    wslAPI.config.get.mockResolvedValueOnce({ recipes: 'bad', recentImages: 42 })
    await s.loadRecipes()
    expect(s.recipes).toEqual([])
    expect(s.recentImages).toEqual([])
  })
})

describe('containers store：统计短 ID 匹配 / 未安装清空', () => {
  it('statsFor 支持短 ID 前缀互相匹配', () => {
    const s = useContainersStore()
    s.stats = {
      full: {
        containerId: 'abcdef1234567890',
        name: 'web',
        cpuPercent: 1,
        memUsedBytes: 1,
        memLimitBytes: 2,
        netRxBytes: 0,
        netTxBytes: 0,
        blockReadBytes: 0,
        blockWriteBytes: 0,
        pids: 1,
        sampledAt: '',
      },
    }
    expect(s.statsFor('abcdef')?.cpuPercent).toBe(1)
    expect(s.statsFor('zzz')).toBeNull()
  })

  it('loadAll 未安装时清空旧实时数据', async () => {
    wslAPI.containers.status.mockResolvedValue({ installed: false, version: '' })
    const s = useContainersStore()
    s.containers = [container]
    s.images = [{ id: 'i' } as never]
    s.networks = [{ id: 'n', name: 'n' } as never]
    s.volumes = [{ name: 'v' } as never]
    s.stats = { c1: { containerId: 'c1' } as never }
    s.sessions = [{ name: 's' } as never]
    await s.loadAll()
    expect(s.containers).toEqual([])
    expect(s.images).toEqual([])
    expect(s.networks).toEqual([])
    expect(s.volumes).toEqual([])
    expect(s.stats).toEqual({})
    expect(s.sessions).toEqual([])
  })
})
