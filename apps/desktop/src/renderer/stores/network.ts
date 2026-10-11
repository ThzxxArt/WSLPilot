import { defineStore } from 'pinia'
import {
  defaultConfig,
  toAppError,
  type AppError,
  type NetworkStatus,
  type PortForwardRule,
  type ProxyConfig,
  type ProxyScriptState,
  type TaskHandle,
} from '@wslpilot/shared'
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
    saving: false,
    statusLoading: false,
    lastError: null as AppError | null,
    /** 最近删除（供 Toast 撤销） */
    lastRemoved: null as PortForwardRule | null,
    /** 代理脚本当前状态（按发行版查询结果） */
    proxyScript: null as ProxyScriptState | null,
    /** 代际守卫：并发 load/save 时只认最新一次发起的响应（防旧响应覆盖新数据） */
    loadGen: 0,
    statusGen: 0,
    proxyStateGen: 0,
    rulesSaveGen: 0,
    proxySaveGen: 0,
  }),

  getters: {
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
      const gen = ++this.loadGen
      this.lastError = null
      try {
        // 规则与代理必须一起提交：先写 rules 再 await getProxy 会在后者失败时
        // 留下「规则已刷新、代理还是旧值」的混合态（review 根治）
        const rules = await window.wslAPI.network.listRules()
        const proxy = await window.wslAPI.network.getProxy()
        if (gen !== this.loadGen) return
        this.rules = Array.isArray(rules) ? rules : []
        this.proxy = proxy
      } catch (e) {
        if (gen !== this.loadGen) return
        this.lastError = toAppError(e)
      }
    },

    async loadStatus() {
      const gen = ++this.statusGen
      this.statusLoading = true
      try {
        const status = await window.wslAPI.network.status()
        if (gen !== this.statusGen) return
        this.status = status
      } catch (e) {
        if (gen !== this.statusGen) return
        this.lastError = toAppError(e)
      } finally {
        if (gen === this.statusGen) this.statusLoading = false
      }
    },

    async persistRules(next: PortForwardRule[]) {
      const gen = ++this.rulesSaveGen
      this.saving = true
      this.lastError = null
      try {
        await window.wslAPI.network.saveRules(next)
        // 有更新的写入在途时，旧响应不得覆盖新状态
        if (gen === this.rulesSaveGen) this.rules = next
      } catch (e) {
        const err = toAppError(e)
        if (gen === this.rulesSaveGen) this.lastError = err
        throw err
      } finally {
        if (gen === this.rulesSaveGen) this.saving = false
      }
    },

    /**
     * 新增 / 更新 / 重命名一条规则。
     * `originalId`：编辑态改 id 时传入旧 id，命中旧条目整体替换（重命名）；
     * 不传则按 `rule.id` 匹配（同 id 覆盖，否则新增）。
     */
    async upsert(rule: PortForwardRule, originalId?: string) {
      const next = [...this.rules]
      const key = originalId?.trim() || rule.id
      const idx = next.findIndex((r) => r.id === key)
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
      const restored = this.lastRemoved
      if (!restored) return
      // 成功后才清撤销缓冲：失败时仍可重试，绝不把被删项弄丢（review 乐观清除无回滚）
      await this.upsert(restored)
      this.lastRemoved = null
    },

    /** 启用/停用开关（写回 network.jsonc） */
    async setEnabled(id: string, enabled: boolean) {
      const target = this.rules.find((r) => r.id === id)
      if (!target) return
      await this.persistRules(this.rules.map((r) => (r.id === id ? { ...r, enabled } : r)))
    },

    async saveProxy(proxy: ProxyConfig) {
      const gen = ++this.proxySaveGen
      this.saving = true
      this.lastError = null
      try {
        await window.wslAPI.network.saveProxy(proxy)
        if (gen === this.proxySaveGen) this.proxy = proxy
      } catch (e) {
        const err = toAppError(e)
        if (gen === this.proxySaveGen) this.lastError = err
        throw err
      } finally {
        if (gen === this.proxySaveGen) this.saving = false
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
      const gen = ++this.proxyStateGen
      this.lastError = null
      try {
        const script = await window.wslAPI.network.proxyState(distro)
        if (gen !== this.proxyStateGen) return
        this.proxyScript = script
      } catch (e) {
        if (gen !== this.proxyStateGen) return
        this.lastError = toAppError(e)
        this.proxyScript = null
      }
    },
  },
})
