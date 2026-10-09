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
}

/**
 * 输出缓冲（导出会话 / 挂载回放用）。
 * 刻意放在响应式系统之外：高吞吐输出不得触发整树重渲染（review M6）。
 */
const buffers = new Map<string, string>()
const BUFFER_LIMIT = 200 * 1024

/**
 * adopt 之前到达的退出事件（action 临时 PTY 的 pty:data/pty:exit 可能
 * 先于 TaskHandle 返回到达渲染层 — 竞态防护）。
 */
const pendingExits = new Map<string, number>()

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

    async open(
      distro: string,
      opts: { shell?: string; cwd?: string } = {},
    ): Promise<string | null> {
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
        }
        buffers.set(session.ptyId, '')
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

    /**
     * 收编已存在的主进程 PTY 会话（M5 terminal 动作的临时 PTY / 窗口重载恢复）。
     * 不发 pty:create，只登记标签与输出缓冲；保留 adopt 前已到达的数据。
     */
    adopt(
      ptyId: string,
      opts: { title?: string; distro: string; shell?: string },
    ): TerminalSession | null {
      const existing = this.sessions.find((s) => s.ptyId === ptyId)
      if (existing) return existing
      const exitCode = pendingExits.get(ptyId)
      pendingExits.delete(ptyId)
      const session: TerminalSession = {
        ptyId,
        title: opts.title?.trim() || opts.distro,
        distro: opts.distro,
        shell: opts.shell ?? '',
        createdAt: Date.now(),
        alive: exitCode === undefined,
      }
      if (exitCode !== undefined) session.exitCode = exitCode
      // adopt 前到达的输出不丢（竞态防护）
      if (!buffers.has(ptyId)) buffers.set(ptyId, '')
      this.sessions.push(session)
      this.activeId = ptyId
      return session
    },

    /**
     * 恢复主进程中仍存活的会话（窗口刷新 / 重载后找回终端标签）。
     * 静默失败：无法连接主进程时保持空列表即可。
     */
    async recover(): Promise<void> {
      try {
        const infos = await window.wslAPI.terminal.list()
        for (const info of infos ?? []) {
          if (!info?.ptyId) continue
          this.adopt(info.ptyId, {
            title: info.distro,
            distro: info.distro,
            shell: info.shell,
          })
        }
      } catch {
        /* 恢复失败不影响主流程 */
      }
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
        // 失败保留标签，由调用方提示（评审 M5）
        this.lastError = toAppError(e)
        throw this.lastError
      }
      s.alive = false
      this.removeLocal(id)
    },

    removeLocal(id: string) {
      const idx = this.sessions.findIndex((x) => x.ptyId === id)
      if (idx >= 0) this.sessions.splice(idx, 1)
      buffers.delete(id)
      if (this.activeId === id) {
        const next = this.sessions[idx] ?? this.sessions[this.sessions.length - 1]
        this.activeId = next?.ptyId ?? ''
      }
    },

    /** 非响应式缓冲读取（导出/回放） */
    getBuffer(id: string): string {
      return buffers.get(id) ?? ''
    },

    appendOutput(id: string, chunk: string) {
      // 未知会话的输出也先缓冲：action 临时 PTY 的数据可能早于 adopt 到达（竞态防护）
      if (!buffers.has(id)) buffers.set(id, '')
      let buf = (buffers.get(id) ?? '') + chunk
      if (buf.length > BUFFER_LIMIT) {
        // 按码点边界截断，避免劈开代理对（评审 M1）
        let slice = buf.slice(buf.length - BUFFER_LIMIT)
        // 向前跳过残缺代理对
        const first = slice.charCodeAt(0)
        if (first >= 0xd800 && first <= 0xdbff) {
          slice = slice.slice(1)
        }
        buf = slice
      }
      buffers.set(id, buf)
    },

    handleExit(id: string, code: number) {
      const s = this.sessions.find((x) => x.ptyId === id)
      if (!s) {
        // 退出事件先于 adopt 到达：暂存，adopt 时补终态
        pendingExits.set(id, code)
        return
      }
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
