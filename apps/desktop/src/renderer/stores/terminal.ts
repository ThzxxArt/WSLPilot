import { defineStore } from 'pinia'
import { toAppError, type AppError } from '@shared/errors'

export interface TerminalSession {
  ptyId: string
  /** 显示名（可重命名） */
  title: string
  distro: string
  shell: string
  cwd?: string
  createdAt: number
  /** 会话存活 */
  alive: boolean
  exitCode?: number
  /** 简单输出缓存（用于导出会话，上限 200KB） */
  buffer: string
}

const BUFFER_LIMIT = 200 * 1024

export const useTerminalStore = defineStore('terminal', {
  state: () => ({
    sessions: [] as TerminalSession[],
    activeId: '' as string,
    lastError: null as AppError | null,
    busy: false,
    maxSessions: 10,
  }),

  getters: {
    active: (s) => s.sessions.find((t) => t.ptyId === s.activeId) ?? null,
    canCreate: (s) => s.sessions.filter((t) => t.alive).length < s.maxSessions,
    aliveCount: (s) => s.sessions.filter((t) => t.alive).length,
  },

  actions: {
    async loadLimits() {
      try {
        this.maxSessions = (await window.wslAPI.terminal.maxSessions()) || 10
      } catch {
        /* keep default */
      }
    },

    async open(distro: string, opts: { shell?: string; cwd?: string } = {}): Promise<string | null> {
      this.lastError = null
      if (!this.canCreate) {
        this.lastError = {
          code: 'TASK_FAILED',
          message: `终端会话数已达上限 ${this.maxSessions}`,
          recoverable: true,
          suggestion: '请先关闭部分终端标签',
        }
        return null
      }
      this.busy = true
      try {
        const info = await window.wslAPI.terminal.create({
          distro,
          shell: opts.shell,
          cwd: opts.cwd,
          cols: 80,
          rows: 24,
        })
        const session: TerminalSession = {
          ptyId: info.ptyId,
          title: opts.shell ? `${distro} · ${opts.shell}` : distro,
          distro: info.distro,
          shell: info.shell,
          cwd: opts.cwd,
          createdAt: info.createdAt ?? Date.now(),
          alive: true,
          buffer: '',
        }
        this.sessions.push(session)
        this.activeId = session.ptyId
        return session.ptyId
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      } finally {
        this.busy = false
      }
    },

    setActive(id: string) {
      if (this.sessions.some((s) => s.ptyId === id)) this.activeId = id
    },

    rename(id: string, title: string) {
      const s = this.sessions.find((x) => x.ptyId === id)
      if (s && title.trim()) s.title = title.trim().slice(0, 80)
    },

    async kill(id: string) {
      const s = this.sessions.find((x) => x.ptyId === id)
      if (!s) return
      try {
        await window.wslAPI.terminal.kill(id)
      } catch (e) {
        this.lastError = toAppError(e)
      }
      s.alive = false
      this.removeLocal(id)
    },

    removeLocal(id: string) {
      const idx = this.sessions.findIndex((x) => x.ptyId === id)
      if (idx >= 0) this.sessions.splice(idx, 1)
      if (this.activeId === id) {
        const next = this.sessions[idx] ?? this.sessions[this.sessions.length - 1]
        this.activeId = next?.ptyId ?? ''
      }
    },

    appendOutput(id: string, chunk: string) {
      const s = this.sessions.find((x) => x.ptyId === id)
      if (!s) return
      s.buffer += chunk
      if (s.buffer.length > BUFFER_LIMIT) {
        s.buffer = s.buffer.slice(s.buffer.length - BUFFER_LIMIT)
      }
    },

    handleExit(id: string, code: number) {
      const s = this.sessions.find((x) => x.ptyId === id)
      if (!s) return
      s.alive = false
      s.exitCode = code
    },

    moveTab(from: number, to: number) {
      if (from === to) return
      const arr = this.sessions
      if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item!)
    },
  },
})
