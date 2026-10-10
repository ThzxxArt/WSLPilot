import { defineStore } from 'pinia'
import type {
  NetworkStatus,
  PortForwardRule,
  ProxyConfig,
  ProxyScriptState,
  TaskHandle,
} from '@wslpilot/shared'
import { defaultConfig } from '@shared/config-schema'
import { toAppError, type AppError } from '@shared/errors'
import { useTasksStore } from './tasks'

/**
 * 网络仓（M6）。
 * - 规则与代理的持久化真相源是 network.jsonc（config:get/set 通道）
 * - 应用/移除走 network:* 通道（主进程生成 netsh 参数数组，渲染层只传 id）
 * - 长任务进度由 tasks 仓（task:progress）跟踪
 */
export const useNetworkStore = defineStore('network', {
  state: () => ({
    rules: [] as PortForwardRule[],
    proxy: { ...defaultConfig('network').proxy } as ProxyConfig,
    status: null as NetworkStatus | null,
    loaded: false,
    loading: false,
    saving: false,
    statusLoading: false,
    lastError: null as AppError | null,
    /** 最近删除（供 Toast 撤销） */
    lastRemoved: null as PortForwardRule | null,
    /** 代理脚本当前状态（按发行版查询结果） */
    proxyScript: null as ProxyScriptState | null,
  }),

  getters: {
    byId: (s) => (id: string) => s.rules.find((r) => r.id === id) ?? null,
    enabledRules: (s) => s.rules.filter((r) => r.enabled),
    /** 已在系统中生效的规则数（监听键命中系统转发表） */
    appliedCount: (s) =>
      s.rules.filter((r) =>
        (s.status?.portProxy ?? []).some(
          (e) => e.listenAddress === r.listenAddress && e.listenPort === r.listenPort,
        ),
      ).length,
  },

  actions: {
    async load() {
      this.loading = true
      this.lastError = null
      try {
        const rules = await window.wslAPI.network.listRules()
        this.rules = Array.isArray(rules) ? rules : []
        this.proxy = await window.wslAPI.network.getProxy()
        this.loaded = true
      } catch (e) {
        this.lastError = toAppError(e)
      } finally {
        this.loading = false
      }
    },

    async loadStatus() {
      this.statusLoading = true
      try {
        this.status = await window.wslAPI.network.status()
      } catch (e) {
        this.lastError = toAppError(e)
      } finally {
        this.statusLoading = false
      }
    },

    async persistRules(next: PortForwardRule[]) {
      this.saving = true
      this.lastError = null
      try {
        await window.wslAPI.network.saveRules(next)
        this.rules = next
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      } finally {
        this.saving = false
      }
    },

    async upsert(rule: PortForwardRule) {
      const next = [...this.rules]
      const idx = next.findIndex((r) => r.id === rule.id)
      if (idx >= 0) next[idx] = rule
      else next.push(rule)
      await this.persistRules(next)
    },

    /** 删除并暂存（撤销用）；只删配置，系统里的转发由 removeRule 负责 */
    async remove(id: string) {
      const target = this.rules.find((r) => r.id === id)
      if (!target) return
      await this.persistRules(this.rules.filter((r) => r.id !== id))
      this.lastRemoved = target
    },

    async undoRestore() {
      if (!this.lastRemoved) return
      const restored = this.lastRemoved
      this.lastRemoved = null
      await this.upsert(restored)
    },

    /** 启用/停用开关（写回 network.jsonc） */
    async setEnabled(id: string, enabled: boolean) {
      const target = this.rules.find((r) => r.id === id)
      if (!target) return
      await this.persistRules(this.rules.map((r) => (r.id === id ? { ...r, enabled } : r)))
    },

    async saveProxy(proxy: ProxyConfig) {
      this.saving = true
      this.lastError = null
      try {
        await window.wslAPI.network.saveProxy(proxy)
        this.proxy = proxy
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      } finally {
        this.saving = false
      }
    },

    /** 应用单条规则 → 长任务 */
    async applyRule(id: string): Promise<TaskHandle> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.network.apply(id)
        useTasksStore().track(handle, { type: 'network', message: `应用转发规则 ${id}` })
        return handle
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    /** 应用全部启用规则 → 长任务 */
    async applyAll(): Promise<TaskHandle> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.network.applyAll()
        useTasksStore().track(handle, { type: 'network', message: '应用全部转发规则' })
        return handle
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    /** 从系统移除监听（配置里的规则保留） */
    async removeFromSystem(id: string): Promise<TaskHandle> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.network.remove(id)
        useTasksStore().track(handle, { type: 'network', message: `移除转发 ${id}` })
        return handle
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    /** 代理写入发行版（/etc/profile.d/wslpilot-proxy.sh） */
    async proxyApply(distro: string) {
      this.lastError = null
      try {
        await window.wslAPI.network.proxyApply(distro)
        this.proxyScript = await window.wslAPI.network.proxyState(distro)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    async proxyClear(distro: string) {
      this.lastError = null
      try {
        await window.wslAPI.network.proxyClear(distro)
        this.proxyScript = await window.wslAPI.network.proxyState(distro)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    async loadProxyState(distro: string) {
      this.lastError = null
      try {
        this.proxyScript = await window.wslAPI.network.proxyState(distro)
      } catch (e) {
        this.lastError = toAppError(e)
        this.proxyScript = null
      }
    },
  },
})
