import { defineStore } from 'pinia'

/** 终端工作台 UI 状态（不持久化；布局持久化在 ui-state） */
export const useWorkbenchStore = defineStore('workbench', {
  state: () => ({
    focusMode: false,
    sessionRailOpen: false,
    toolbarOpen: false,
  }),
  actions: {
    toggleFocus() {
      this.focusMode = !this.focusMode
      if (this.focusMode) this.toolbarOpen = false
    },
    exitFocus() {
      this.focusMode = false
    },
    toggleSessionRail() {
      this.sessionRailOpen = !this.sessionRailOpen
    },
    toggleToolbar() {
      this.toolbarOpen = !this.toolbarOpen
    },
    closeToolbar() {
      this.toolbarOpen = false
    },
  },
})
