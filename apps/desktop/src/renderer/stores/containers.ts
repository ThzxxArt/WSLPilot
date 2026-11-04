import { defineStore } from 'pinia'
import {
  toAppError,
  type AppError,
  type ContainerRecipe,
  type ContainerRunSpec,
  type ContainerStats,
  type ContainerSummary,
  type TaskHandle,
  type TaskType,
  type WslcCapabilities,
  type WslcImage,
  type WslcNetwork,
  type WslcSessionInfo,
  type WslcSettings,
  type WslcSystemInfo,
  type WslcVolume,
} from '@wslpilot/shared'
import { useTasksStore } from './tasks'

type TrackType = Extract<
  TaskType,
  | 'container-run'
  | 'container-start'
  | 'container-stop'
  | 'container-restart'
  | 'container-remove'
  | 'container-prune'
  | 'container-logs'
  | 'image-pull'
  | 'image-build'
  | 'image-prune'
  | 'wslc-session'
>

export const useContainersStore = defineStore('containers', {
  state: () => ({
    status: null as WslcCapabilities | null,
    containers: [] as ContainerSummary[],
    stats: {} as Record<string, ContainerStats>,
    images: [] as WslcImage[],
    networks: [] as WslcNetwork[],
    volumes: [] as WslcVolume[],
    system: null as WslcSystemInfo | null,
    sessions: [] as WslcSessionInfo[],
    settings: null as {
      path: string
      exists: boolean
      content: string
      model: WslcSettings
    } | null,
    /** containers.jsonc：只存用户意图（配方 / 最近镜像） */
    recipes: [] as ContainerRecipe[],
    recentImages: [] as string[],
    loading: false,
    lastError: null as AppError | null,
    loadGen: 0,
  }),

  getters: {
    installed: (s) => s.status?.installed === true,
    running: (s) => s.containers.filter((c) => c.state === 'running'),
    statsFor:
      (s) =>
      (id: string): ContainerStats | null =>
        s.stats[id] ??
        Object.values(s.stats).find(
          (x) => x.containerId.startsWith(id) || id.startsWith(x.containerId),
        ) ??
        null,
  },

  actions: {
    async loadStatus(force = false) {
      try {
        this.status = await window.wslAPI.containers.status(force)
      } catch (e) {
        this.status = null
        this.lastError = toAppError(e)
      }
    },

    /** 读取 containers.jsonc（与 wslc 是否安装无关；损坏时降级为空） */
    async loadRecipes() {
      try {
        const file = (await window.wslAPI.config.get('containers')) as {
          recipes?: ContainerRecipe[]
          recentImages?: string[]
        }
        this.recipes = Array.isArray(file.recipes) ? file.recipes : []
        this.recentImages = Array.isArray(file.recentImages) ? file.recentImages : []
      } catch (e) {
        this.lastError = toAppError(e)
      }
    },

    async saveRecipe(recipe: ContainerRecipe) {
      const next = [...this.recipes.filter((r) => r.id !== recipe.id), recipe]
      await window.wslAPI.config.set('containers', { recipes: next })
      this.recipes = next
    },

    async deleteRecipe(id: string) {
      const next = this.recipes.filter((r) => r.id !== id)
      await window.wslAPI.config.set('containers', { recipes: next })
      this.recipes = next
    },

    async rememberImage(ref: string) {
      const image = ref.trim()
      if (!image) return
      const next = [image, ...this.recentImages.filter((x) => x !== image)].slice(0, 30)
      if (next.join('\n') === this.recentImages.join('\n')) return
      try {
        await window.wslAPI.config.set('containers', { recentImages: next })
        this.recentImages = next
      } catch {
        /* 最近镜像只是便利数据，失败不阻塞任务 */
      }
    },

    async loadAll(forceStatus = false) {
      const gen = ++this.loadGen
      this.loading = true
      this.lastError = null
      try {
        await this.loadRecipes()
        await this.loadStatus(forceStatus)
        if (!this.status?.installed) {
          // wslc 不可用/被卸载：清空实时数据，避免展示过期容器
          this.containers = []
          this.stats = {}
          this.images = []
          this.networks = []
          this.volumes = []
          this.system = null
          this.sessions = []
          return
        }
        const [containers, images, networks, volumes, stats, system, sessions] = await Promise.all([
          window.wslAPI.containers.list(),
          window.wslAPI.images.list(),
          window.wslAPI.networks.list(),
          window.wslAPI.volumes.list(),
          window.wslAPI.containers.stats().catch(() => []),
          window.wslAPI.containers.systemInfo().catch(() => null),
          window.wslAPI.containers.sessionList().catch(() => []),
        ])
        if (gen !== this.loadGen) return
        this.containers = containers
        this.images = images
        this.networks = networks
        this.volumes = volumes
        this.stats = Object.fromEntries(stats.map((x) => [x.containerId, x]))
        this.system = system
        this.sessions = sessions
      } catch (e) {
        if (gen === this.loadGen) this.lastError = toAppError(e)
      } finally {
        if (gen === this.loadGen) this.loading = false
      }
    },

    async loadContainers() {
      try {
        this.containers = await window.wslAPI.containers.list()
        const stats = await window.wslAPI.containers.stats().catch(() => [])
        this.stats = Object.fromEntries(stats.map((x) => [x.containerId, x]))
      } catch (e) {
        this.lastError = toAppError(e)
      }
    },

    /** 仅刷新统计（轮询用；不重复拉列表） */
    async refreshStats() {
      const stats = await window.wslAPI.containers.stats()
      this.stats = Object.fromEntries(stats.map((x) => [x.containerId, x]))
    },

    /** 事件推送后由页面调度的一次性重载（避免 store 内定时器泄漏） */
    async reloadFromEvent() {
      await this.loadAll(false)
    },

    track(handle: TaskHandle, type: TrackType, message: string) {
      useTasksStore().track(handle, { type, message })
      return handle
    },

    async run(spec: ContainerRunSpec) {
      this.lastError = null
      try {
        const handle = await window.wslAPI.containers.run(spec)
        void this.rememberImage(spec.image)
        return this.track(handle, 'container-run', `运行容器 ${spec.name ?? spec.image}`)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async start(id: string) {
      try {
        const h = await window.wslAPI.containers.start(id)
        return this.track(h, 'container-start', `启动容器 ${id}`)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async stop(id: string, timeoutSec?: number) {
      try {
        const h = await window.wslAPI.containers.stop(id, timeoutSec)
        return this.track(h, 'container-stop', `停止容器 ${id}`)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async restart(id: string) {
      try {
        const h = await window.wslAPI.containers.restart(id)
        return this.track(h, 'container-restart', `重启容器 ${id}`)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async remove(id: string, force = false) {
      try {
        const h = await window.wslAPI.containers.remove(id, force)
        return this.track(h, 'container-remove', `删除容器 ${id}`)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async prune() {
      try {
        const h = await window.wslAPI.containers.prune()
        return this.track(h, 'container-prune', '清理已停止容器')
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async logs(id: string, follow = false) {
      try {
        const h = await window.wslAPI.containers.logs(id, follow)
        return this.track(h, 'container-logs', `读取容器 ${id} 日志`)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async pull(ref: string) {
      try {
        const h = await window.wslAPI.images.pull(ref)
        void this.rememberImage(ref)
        return this.track(h, 'image-pull', `拉取镜像 ${ref}`)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async build(tag: string, context: string) {
      try {
        const h = await window.wslAPI.images.build(tag, context)
        void this.rememberImage(tag)
        return this.track(h, 'image-build', `构建镜像 ${tag}`)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async pruneImages(all = false) {
      try {
        const h = await window.wslAPI.images.prune(all)
        return this.track(h, 'image-prune', '清理镜像')
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async removeImage(ref: string) {
      try {
        await window.wslAPI.images.remove(ref)
        await this.loadAll()
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async createNetwork(opts: {
      name: string
      driver?: string
      subnet?: string
      gateway?: string
    }) {
      try {
        await window.wslAPI.networks.create(opts)
        this.networks = await window.wslAPI.networks.list()
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async removeNetwork(name: string) {
      try {
        await window.wslAPI.networks.remove(name)
        this.networks = await window.wslAPI.networks.list()
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async createVolume(name: string) {
      try {
        await window.wslAPI.volumes.create(name)
        this.volumes = await window.wslAPI.volumes.list()
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async removeVolume(name: string) {
      try {
        await window.wslAPI.volumes.remove(name)
        this.volumes = await window.wslAPI.volumes.list()
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async loadSettings() {
      try {
        this.settings = await window.wslAPI.containers.settingsRead()
      } catch (e) {
        this.lastError = toAppError(e)
      }
    },
    async saveSettings(content: string) {
      try {
        await window.wslAPI.containers.settingsWrite(content)
        await this.loadSettings()
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
    async terminateSession() {
      try {
        const h = await window.wslAPI.containers.sessionTerminate()
        return this.track(h, 'wslc-session', '终止 wslc 容器会话')
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
  },
})
