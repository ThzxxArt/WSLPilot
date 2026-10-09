import { defineStore } from 'pinia'
import type { TaskHandle, WslAction } from '@wslpilot/shared'
import { toAppError, type AppError } from '@shared/errors'
import { useTerminalStore } from './terminal'

/**
 * 自定义动作仓（M5）。
 * 数据源为 actions.jsonc（config:get/set 通道），执行走 action:run（主进程白名单）。
 * 删除支持撤销（§13.4）：lastRemoved 暂存被删动作，undoRestore 回写。
 * 执行进度不在本仓：长任务进度由 tasks 仓（task:progress）跟踪。
 */
export const useActionsStore = defineStore('actions', {
  state: () => ({
    items: [] as WslAction[],
    loaded: false,
    loading: false,
    saving: false,
    lastError: null as AppError | null,
    /** 最近删除（供 Toast 撤销） */
    lastRemoved: null as WslAction | null,
  }),

  getters: {
    byId: (s) => (id: string) => s.items.find((a) => a.id === id) ?? null,
    /** 全部动作（发行版级 + 全局） */
    all: (s) => s.items,
  },

  actions: {
    async load() {
      this.loading = true
      this.lastError = null
      try {
        const list = (await window.wslAPI.actions.list()) as WslAction[]
        this.items = Array.isArray(list) ? list : []
        this.loaded = true
      } catch (e) {
        this.lastError = toAppError(e)
      } finally {
        this.loading = false
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
      const next = [...this.items]
      const idx = next.findIndex((a) => a.id === action.id)
      if (idx >= 0) next[idx] = action
      else next.push(action)
      await this.persist(next)
    },

    /** 删除并暂存（撤销用） */
    async remove(id: string) {
      const target = this.items.find((a) => a.id === id)
      if (!target) return
      await this.persist(this.items.filter((a) => a.id !== id))
      this.lastRemoved = target
    },

    /** 撤销删除 */
    async undoRestore() {
      if (!this.lastRemoved) return
      const restored = this.lastRemoved
      this.lastRemoved = null
      await this.upsert(restored)
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
