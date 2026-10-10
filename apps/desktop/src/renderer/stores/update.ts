import { defineStore } from 'pinia'
import type { UpdateState, UpdateStatus } from '@wslpilot/shared'
import { toAppError, type AppError } from '@shared/errors'

function initialState() {
  return {
    status: 'idle' as UpdateStatus,
    version: '',
    releaseNotes: '',
    percent: 0,
    error: '',
    currentVersion: '',
    feedUrl: '',
    attached: false,
    busy: false,
    lastError: null as AppError | null,
    /** 供界面一次性提示 */
    errorAt: 0,
  }
}

/**
 * 自动更新状态仓（M7）。
 * 真相源在主进程 UpdateService；本仓镜像 `update:changed` 事件并提供操作入口。
 */
export const useUpdateStore = defineStore('update', {
  state: initialState,

  actions: {
    applyState(s: UpdateState) {
      this.status = s.status
      this.version = s.version ?? ''
      this.releaseNotes = s.releaseNotes ?? ''
      this.percent = typeof s.percent === 'number' ? s.percent : 0
      this.error = s.error ?? ''
      this.currentVersion = s.currentVersion
      this.feedUrl = s.feedUrl ?? ''
    },

    /** 订阅主进程状态推送（App 挂载时调用一次）；返回解绑函数 */
    attach(): () => void {
      this.attached = true
      const off = window.wslAPI?.update.onChanged((s) => this.applyState(s))
      return off ?? (() => {})
    },

    async load() {
      try {
        const s = await window.wslAPI.update.status()
        this.applyState(s)
      } catch (e) {
        this.lastError = toAppError(e)
      }
    },

    async check() {
      this.busy = true
      try {
        const s = await window.wslAPI.update.check()
        this.applyState(s)
        return s
      } catch (e) {
        this.lastError = toAppError(e)
        this.errorAt = Date.now()
        throw e
      } finally {
        this.busy = false
      }
    },

    async download() {
      this.busy = true
      try {
        const s = await window.wslAPI.update.download()
        this.applyState(s)
        return s
      } catch (e) {
        this.lastError = toAppError(e)
        this.errorAt = Date.now()
        throw e
      } finally {
        this.busy = false
      }
    },

    async install() {
      try {
        await window.wslAPI.update.install()
      } catch (e) {
        this.lastError = toAppError(e)
        this.errorAt = Date.now()
        throw e
      }
    },
  },
})
