/**
 * WSL 能力 store（0.1.4）— 渲染层唯一能力事实源。
 *
 * 页面/按钮不各自猜版本，也不各自调 `app.wslEnv`；统一从这里读 flags。
 * 未加载/探测失败时 `can()` 一律 false（fail-soft：宁可禁用，也不让用户点了才报错）。
 */
import { defineStore } from 'pinia'
import {
  toAppError,
  type AppError,
  type WslCapabilities,
  type WslCapabilityFlags,
  type WslEnvInfo,
  WSL_FEATURE_META,
} from '@wslpilot/shared'

export const useWslEnvStore = defineStore('wslEnv', {
  state: () => ({
    env: null as WslEnvInfo | null,
    loading: false,
    loaded: false,
    lastError: null as AppError | null,
  }),

  getters: {
    capabilities: (s): WslCapabilities | null => s.env?.capabilities ?? null,
    installed: (s): boolean => s.env?.installed === true,
    /** 能力是否可用；未探测/未安装/旧版一律 false */
    can:
      (s) =>
      (flag: keyof WslCapabilityFlags): boolean =>
        s.env?.capabilities?.flags?.[flag] === true,
    /** 不可用时的统一文案（含最低版本与当前版本） */
    requirement:
      (s) =>
      (flag: keyof WslCapabilityFlags): string => {
        const meta = WSL_FEATURE_META[flag]
        const current = s.env?.capabilities?.wslVersion || s.env?.wslVersion || '未知'
        return `${meta.label}需要 WSL ${meta.minVersion}+（当前 ${current}）`
      },
  },

  actions: {
    async load(force = false): Promise<void> {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      this.lastError = null
      try {
        this.env = await window.wslAPI.app.wslEnv()
        this.loaded = true
      } catch (e) {
        this.lastError = toAppError(e)
        this.env = null
      } finally {
        this.loading = false
      }
    },

    async refresh(): Promise<void> {
      await this.load(true)
    },

    /** WSL 更新/安装后能力可能变化：清空缓存并重拉 */
    invalidate(): void {
      this.loaded = false
    },
  },
})
