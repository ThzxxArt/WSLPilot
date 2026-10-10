import { defineStore } from 'pinia'
import type { UpdateState, UpdateStatus } from '@wslpilot/shared'

function initialState() {
  return {
    status: 'idle' as UpdateStatus,
    version: '',
    releaseNotes: '',
    percent: 0,
    error: '',
    currentVersion: '',
    feedUrl: '',
    busy: false,
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
      const off = window.wslAPI?.update.onChanged((s) => this.applyState(s))
      return off ?? (() => {})
    },

    async load() {
      try {
        const s = await window.wslAPI.update.status()
        this.applyState(s)
      } catch (e) {
        // 状态拉取失败如实落 error 字段（界面状态行可见），不静默
        this.error = e instanceof Error ? e.message : String(e)
      }
    },

    async check() {
      this.busy = true
      try {
        const s = await window.wslAPI.update.check()
        this.applyState(s)
        return s
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
      } finally {
        this.busy = false
      }
    },

    async install() {
      await window.wslAPI.update.install()
    },
  },
})
