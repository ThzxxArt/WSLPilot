import { defineStore } from 'pinia'
import {
  defaultConfig,
  repairDuplicateRuleIds,
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
 * 规则写队列（review 0.1.2 并发 RMW 丢更新根治）：
 * upsert / remove / setEnabled 都是「读 this.rules → 构造 next → 落盘」的读改写，
 * 并发调用各自基于旧快照，后写覆盖先写 → 先前的修改被丢弃。
 * 入队任务在**轮到执行时**才读快照，保证每次 RMW 基于上一次的结果。
 * （参照主进程 config-service.enqueueWrite 的串行写思路）
 */
let rulesWriteQueue: Promise<unknown> = Promise.resolve()

function enqueueRulesWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = rulesWriteQueue.then(fn, fn)
  rulesWriteQueue = next.catch(() => {})
  return next
}

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
    /** 非 silent 请求的发起序号（loading owner 记账，silent 不参与 — review 0.1.2 审计修复） */
    loadingSeq: 0,
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
    /** 重复的规则 id（0.1.4：可一键修复，避免整个文件永远无法保存） */
    duplicateRuleIds: (s): string[] => {
      const seen = new Set<string>()
      const dup = new Set<string>()
      for (const r of s.rules) {
        if (seen.has(r.id)) dup.add(r.id)
        seen.add(r.id)
      }
      return [...dup]
    },
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

    /** silent：轮询等后台刷新不点亮 statusLoading，避免按钮反复闪 loading */
    async loadStatus(opts: { silent?: boolean } = {}) {
      const gen = ++this.statusGen
      /**
       * review 0.1.2 审计修复：loading 用「发起序号 owner」记账，silent 不参与。
       * 根因：此前 finally 以 statusGen 判定，12s silent 轮询会自增 statusGen，
       * 使在途的非 silent 请求（刷新按钮）永远清不掉 statusLoading；silent 自身又不清。
       * 现在只有最新一次非 silent 请求能复位 loading，silent 仍照常参与数据代际。
       */
      const loadingOwner = opts.silent ? 0 : ++this.loadingSeq
      if (loadingOwner !== 0) this.statusLoading = true
      try {
        const status = await window.wslAPI.network.status()
        if (gen !== this.statusGen) return
        this.status = status
      } catch (e) {
        if (gen !== this.statusGen) return
        this.lastError = toAppError(e)
      } finally {
        if (loadingOwner !== 0 && loadingOwner === this.loadingSeq) this.statusLoading = false
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
     * 修复重复规则 id（0.1.4）：保留第一条，后续改成 `<id>-2`...
     * 返回是否真的改了；没有重复时幂等不写盘。
     */
    async repairRuleIds(): Promise<boolean> {
      // 必须走写队列：直接读 this.rules 会与排队的 setEnabled/upsert 基于同一旧快照，
      // 后写覆盖先写（开关刚切换就点修复会丢改动）。
      return enqueueRulesWrite(async () => {
        const { rules, changed } = repairDuplicateRuleIds(this.rules)
        if (!changed) return false
        await this.persistRules(rules)
        return true
      })
    },

    /**
     * 新增 / 更新 / 重命名一条规则。
     * `originalId`：编辑态改 id 时传入旧 id，命中旧条目整体替换（重命名）；
     * 不传则按 `rule.id` 匹配（同 id 覆盖，否则新增）。
     * 走写队列：快照在轮到时读取，并发调用不丢更新（review 0.1.2 根治）。
     */
    async upsert(rule: PortForwardRule, originalId?: string) {
      await enqueueRulesWrite(async () => {
        const next = [...this.rules]
        const key = originalId?.trim() || rule.id
        const idx = next.findIndex((r) => r.id === key)
        if (idx >= 0) next[idx] = rule
        else next.push(rule)
        await this.persistRules(next)
      })
    },

    /**
     * 删除并暂存（撤销用）；只删配置，系统里的转发由 removeRule 负责。
     * 返回被删对象：调用方用闭包快照做撤销，连续删除互不覆盖（review 0.1.2 根治）。
     */
    async remove(id: string): Promise<PortForwardRule | null> {
      return enqueueRulesWrite(async () => {
        const target = this.rules.find((r) => r.id === id)
        if (!target) return null
        await this.persistRules(this.rules.filter((r) => r.id !== id))
        this.lastRemoved = target
        return target
      })
    },

    /** 撤销删除：优先用调用方快照（连续删除场景），无快照回退 lastRemoved */
    async undoRestore(snapshot?: PortForwardRule) {
      const restored = snapshot ?? this.lastRemoved
      if (!restored) return
      // 成功后才清撤销缓冲：失败时仍可重试，绝不把被删项弄丢（review 乐观清除无回滚）
      await this.upsert(restored)
      if (this.lastRemoved?.id === restored.id) this.lastRemoved = null
    },

    /** 启用/停用开关（写回 network.jsonc）；走写队列防与 upsert/remove 并发互覆 */
    async setEnabled(id: string, enabled: boolean) {
      await enqueueRulesWrite(async () => {
        if (!this.rules.some((r) => r.id === id)) return
        await this.persistRules(this.rules.map((r) => (r.id === id ? { ...r, enabled } : r)))
      })
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

    /**
     * 代理写入发行版（/etc/profile.d/wslpilot-proxy.sh）。
     * proxyScript 的赋值走代际守卫：与并发 loadProxyState 交错时只认最新发起的响应
     * （否则写 A 发行版的结果可能盖掉用户后发起查看的 B 发行版脚本 — review 0.1.2 根治）。
     */
    async proxyApply(distro: string) {
      this.lastError = null
      const gen = ++this.proxyStateGen
      try {
        await window.wslAPI.network.proxyApply(distro)
        const script = await window.wslAPI.network.proxyState(distro)
        if (gen === this.proxyStateGen) this.proxyScript = script
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    async proxyClear(distro: string) {
      this.lastError = null
      const gen = ++this.proxyStateGen
      try {
        await window.wslAPI.network.proxyClear(distro)
        const script = await window.wslAPI.network.proxyState(distro)
        if (gen === this.proxyStateGen) this.proxyScript = script
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
