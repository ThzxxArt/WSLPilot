import { defineStore } from 'pinia'
import {
  toAppError,
  type AppError,
  type TaskHandle,
  type UsbDevice,
  type UsbipdStatus,
} from '@wslpilot/shared'
import { useTasksStore } from './tasks'

/**
 * USB 设备仓（M6 usbipd，可选）。
 * usbipd 未安装时 status.installed=false，界面给安装引导而不是报错。
 * bind/unbind 是长任务（需管理员），attach/detach 为快速命令。
 */
export const useDevicesStore = defineStore('devices', {
  state: () => ({
    status: { installed: false, version: '' } as UsbipdStatus,
    items: [] as UsbDevice[],
    loading: false,
    lastError: null as AppError | null,
    /** 代际守卫：重叠 load 时只认最新一次发起的响应（review 0.1.2 根治） */
    loadGen: 0,
  }),

  getters: {
    attachedCount: (s) => s.items.filter((d) => d.state === 'attached').length,
    sharedCount: (s) => s.items.filter((d) => d.state === 'shared').length,
  },

  actions: {
    /** 读取 usbipd 状态与设备清单（未安装时只置 status，不抛错） */
    async load() {
      const gen = ++this.loadGen
      this.loading = true
      this.lastError = null
      try {
        const status = await window.wslAPI.devices.status()
        if (gen !== this.loadGen) return
        this.status = status
        if (status.installed) {
          const list = await window.wslAPI.devices.list()
          // 旧响应晚到不得覆盖新状态（重叠调用：刷新按钮 + 操作后刷新）
          if (gen !== this.loadGen) return
          this.items = Array.isArray(list) ? list : []
        } else {
          this.items = []
        }
      } catch (e) {
        if (gen !== this.loadGen) return
        this.lastError = toAppError(e)
        this.items = []
      } finally {
        if (gen === this.loadGen) this.loading = false
      }
    },

    /** 对外 API 兼容别名：语义即 load（合并重复实现 — review 0.1.2 根治） */
    async refresh() {
      await this.load()
    },

    /** 绑定（共享）→ 长任务（需管理员权限） */
    async bind(busId: string): Promise<TaskHandle> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.devices.bind(busId)
        useTasksStore().track(handle, { type: 'device', message: `绑定设备 ${busId}` })
        return handle
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    async unbind(busId: string): Promise<TaskHandle> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.devices.unbind(busId)
        useTasksStore().track(handle, { type: 'device', message: `解除绑定 ${busId}` })
        return handle
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    /** 附加到 WSL（usbipd 2.x 无需提权） */
    async attach(busId: string, distro?: string) {
      this.lastError = null
      try {
        await window.wslAPI.devices.attach(busId, distro)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    async detach(busId: string) {
      this.lastError = null
      try {
        await window.wslAPI.devices.detach(busId)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },
  },
})
