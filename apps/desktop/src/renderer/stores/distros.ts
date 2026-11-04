import { defineStore } from 'pinia'
import { toAppError, type AppError, type DistroView, type WslState } from '@wslpilot/shared'

export type DistroAction = 'start' | 'terminate' | 'setDefault' | 'shutdown' | 'refresh'

export const useDistrosStore = defineStore('distros', {
  state: () => ({
    items: [] as DistroView[],
    loading: false,
    lastError: null as AppError | null,
    busy: new Set<string>(),
    /** 代际守卫：并发 refresh 时只认最新一次发起的响应 */
    loadGen: 0,
  }),

  getters: {
    runningCount: (s) => s.items.filter((d) => d.state === 'Running').length,
    defaultDistro: (s) =>
      s.items.find((d) => d.isDefault && d.meta?.hidden !== true) ??
      s.items.find((d) => d.meta?.hidden !== true) ??
      s.items.find((d) => d.isDefault) ??
      null,
    /**
     * 按名称查找（大小写不敏感 — review 0.1.2 根治）：
     * WSL 发行版名不区分大小写，此前精确匹配导致 'ubuntu' 查不到 'Ubuntu'。
     */
    /** 隐藏内部发行版（docker-desktop 等）后的列表；distros.jsonc v3 meta.hidden */
    visibleItems: (s) => s.items.filter((d) => d.meta?.hidden !== true),
    hiddenCount: (s) => s.items.filter((d) => d.meta?.hidden === true).length,
    byName: (s) => (name: string) => {
      const key = name.toLowerCase()
      return s.items.find((d) => d.name.toLowerCase() === key) ?? null
    },
  },

  actions: {
    /**
     * 读取发行版列表。
     *
     * `silent` 用于轮询：不切换全局 `loading`，否则空列表下每 5 秒都会
     * 「骨架屏 → 空状态」闪一次，页面持续抖动。错误也不在请求前清空，
     * 只在成功时清除；这样轮询失败期间错误横幅保持稳定，不会周期性消失/重现。
     */
    async refresh(opts: { silent?: boolean } = {}) {
      const gen = ++this.loadGen
      if (opts.silent !== true) this.loading = true
      try {
        const list = await window.wslAPI.distros.list()
        if (gen !== this.loadGen) return
        // meta.pinned = 置顶（设计书 §6.4）：固定排在最前（此前该字段能写不能看 — 幽灵字段根治）
        this.items = [...list].sort((a, b) => Number(!!b.meta?.pinned) - Number(!!a.meta?.pinned))
        this.lastError = null
      } catch (e) {
        if (gen !== this.loadGen) return
        this.lastError = toAppError(e)
      } finally {
        if (gen === this.loadGen) this.loading = false
      }
    },

    async start(name: string) {
      await this.run(name, 'start', () => window.wslAPI.distros.start(name))
    },

    async terminate(name: string) {
      await this.run(name, 'terminate', () => window.wslAPI.distros.terminate(name))
    },

    async setDefault(name: string) {
      await this.run(name, 'setDefault', async () => {
        await window.wslAPI.distros.setDefault(name)
        for (const d of this.items) d.isDefault = d.name === name
      })
    },

    async shutdownAll() {
      this.busy.add('*')
      this.lastError = null
      try {
        await window.wslAPI.distros.shutdown()
        for (const d of this.items) {
          if (d.state !== 'Stopped') d.state = 'Stopped' as WslState
        }
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      } finally {
        this.busy.delete('*')
      }
    },

    async run(name: string, action: DistroAction, fn: () => Promise<void>) {
      // busy key 归一为小写（review 0.1.2 根治）：与「WSL 名不区分大小写」一致，
      // 否则 start('ubuntu') 与 isBusy('Ubuntu') 对不上，按钮 loading 失效。
      const key = `${action}:${name.toLowerCase()}`
      this.busy.add(key)
      this.lastError = null
      try {
        await fn()
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      } finally {
        this.busy.delete(key)
      }
    },

    isBusy(name: string, action?: DistroAction) {
      const normalized = name.toLowerCase()
      if (action) return this.busy.has(`${action}:${normalized}`)
      return [...this.busy].some((k) => k.endsWith(`:${normalized}`))
    },
  },
})
