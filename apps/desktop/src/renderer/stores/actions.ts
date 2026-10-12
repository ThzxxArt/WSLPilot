import { defineStore } from 'pinia'
import { toAppError, type AppError, type TaskHandle, type WslAction } from '@wslpilot/shared'
import { useTerminalStore } from './terminal'

/**
 * 动作写队列（review 0.1.2 并发 RMW 丢更新根治）：
 * upsert / remove 都是「读 items → 构造 next → 落盘」，并发调用各自基于旧快照，
 * 后写覆盖先写 → 丢更新。入队任务在轮到时才读快照，保证基于上一次的结果。
 * （与 network 仓、主进程 config-service.enqueueWrite 同一思路）
 */
let actionsWriteQueue: Promise<unknown> = Promise.resolve()

function enqueueActionsWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = actionsWriteQueue.then(fn, fn)
  actionsWriteQueue = next.catch(() => {})
  return next
}

/**
 * 自定义动作仓（M5）。
 * 数据源为 actions.jsonc（config:get/set 通道），执行走 action:run（主进程白名单）。
 * 删除支持撤销（§13.4）：remove 返回被删对象供调用方闭包快照，undoRestore 回写；
 * lastRemoved 仅作无快照时的兜底。
 * 执行进度不在本仓：长任务进度由 tasks 仓（task:progress）跟踪。
 */
export const useActionsStore = defineStore('actions', {
  state: () => ({
    items: [] as WslAction[],
    loaded: false,
    saving: false,
    lastError: null as AppError | null,
    /** 最近删除（供 Toast 撤销） */
    lastRemoved: null as WslAction | null,
  }),

  actions: {
    async load() {
      this.lastError = null
      try {
        const list = (await window.wslAPI.actions.list()) as WslAction[]
        this.items = Array.isArray(list) ? list : []
        this.loaded = true
      } catch (e) {
        this.lastError = toAppError(e)
      }
    },

    async persist(next: WslAction[]) {
      this.saving = true
      this.lastError = null
      try {
        await window.wslAPI.actions.save(next)
        this.items = next
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      } finally {
        this.saving = false
      }
    },

    async upsert(action: WslAction) {
      // 快照在队列轮到时读取：并发 upsert 不丢更新（review 0.1.2 根治）
      await enqueueActionsWrite(async () => {
        const next = [...this.items]
        const idx = next.findIndex((a) => a.id === action.id)
        if (idx >= 0) next[idx] = action
        else next.push(action)
        await this.persist(next)
      })
    },

    /**
     * 删除并暂存（撤销用）。
     * 返回被删对象：调用方用闭包快照做撤销，连续删 A、B 后点 A 的撤销恢复 A
     * 而不是被 B 覆盖（review 0.1.2 根治）。
     */
    async remove(id: string): Promise<WslAction | null> {
      return enqueueActionsWrite(async () => {
        const target = this.items.find((a) => a.id === id)
        if (!target) return null
        await this.persist(this.items.filter((a) => a.id !== id))
        this.lastRemoved = target
        return target
      })
    },

    /** 撤销删除：优先用调用方快照（连续删除场景），无快照回退 lastRemoved */
    async undoRestore(snapshot?: WslAction) {
      const restored = snapshot ?? this.lastRemoved
      if (!restored) return
      // 成功后才清撤销缓冲：失败时仍可重试，绝不把被删项弄丢（review 乐观清除无回滚）
      await this.upsert(restored)
      if (this.lastRemoved?.id === restored.id) this.lastRemoved = null
    },

    /** 执行动作（confirm 由调用方负责）；返回 TaskHandle（terminal 动作含 ptyId） */
    async run(actionId: string, distro?: string): Promise<TaskHandle> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.actions.run(actionId, distro)
        // terminal 动作的临时 PTY 收编进终端工作区（复用临时 PTY — 设计书 §9.6）
        if (handle.ptyId) {
          const action = this.items.find((a) => a.id === actionId)
          useTerminalStore().adopt(handle.ptyId, {
            title: action?.label ?? actionId,
            distro: handle.distro ?? distro ?? '',
          })
        }
        return handle
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
  },
})
