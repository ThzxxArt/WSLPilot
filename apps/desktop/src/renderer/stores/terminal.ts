import { defineStore } from 'pinia'
import { toAppError, type AppError } from '@wslpilot/shared'
import { useDistrosStore } from './distros'

export interface TerminalSession {
  ptyId: string
  /** 显示名（可重命名） */
  title: string
  distro: string
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
 * 孤儿（从不被 adopt 的会话）单独记账并限额淘汰，绝不触碰存活会话的缓冲。
 */
const pendingExits = new Map<string, number>()
/** 孤儿缓冲 id（插入序）— 只淘汰孤儿，不影响已收编会话 */
const orphanIds = new Set<string>()
const ORPHAN_LIMIT = 16

function dropOrphans(): void {
  while (orphanIds.size > ORPHAN_LIMIT) {
    const oldest = orphanIds.values().next().value as string | undefined
    if (oldest === undefined) break
    orphanIds.delete(oldest)
    buffers.delete(oldest)
    pendingExits.delete(oldest)
  }
}

/** 为未收编的会话登记输出缓冲（超限淘汰最旧孤儿） */
function rememberOrphan(id: string): void {
  if (buffers.has(id)) return
  buffers.set(id, '')
  orphanIds.add(id)
  dropOrphans()
}

/** 记录孤儿会话的退出事件（adopt 时补终态；已有输出保留供回放） */
function rememberExit(id: string, code: number): void {
  pendingExits.set(id, code)
  if (!buffers.has(id)) {
    buffers.set(id, '')
  }
  orphanIds.add(id)
  dropOrphans()
}

/** 会话被收编：脱离孤儿记账，由 removeLocal 正常清理 */
function adoptOrphan(id: string): void {
  orphanIds.delete(id)
}

/**
 * @internal 仅供测试：重置/观测模块级会话缓冲状态。
 * 这些 Map 刻意放在响应式系统之外（高吞吐输出不得触发整树重渲染），
 * 但用例间必须可隔离，且「孤儿限额淘汰」必须可被真实断言（review 假信心根治）。
 */
export const __terminalBuffersForTest = {
  reset(): void {
    buffers.clear()
    pendingExits.clear()
    orphanIds.clear()
  },
  bufferCount: (): number => buffers.size,
  orphanCount: (): number => orphanIds.size,
  has: (id: string): boolean => buffers.has(id),
}

export const useTerminalStore = defineStore('terminal', {
  state: () => ({
    sessions: [] as TerminalSession[],
    activeId: '' as string,
    lastError: null as AppError | null,
    maxSessions: 10,
    /**
     * 创建中的发行版名单（review 0.1.2 TOCTOU 根治）：
     * open() 的「检查上限 → await create → push 会话」跨越 await，并发调用
     * 会同时通过上限检查从而突破 maxSessions；同一发行版双击也会开两个标签。
     * 在同步段预留名额并做同 distro 去重，跨 await 期间名额不被重复占用。
     */
    creatingDistros: [] as string[],
  }),

  getters: {
    active: (s) => s.sessions.find((t) => t.ptyId === s.activeId) ?? null,
    /** 创建中的名额同样计入（否则并发创建绕过上限） */
    canCreate: (s) =>
      s.sessions.filter((t) => t.alive).length + s.creatingDistros.length < s.maxSessions,
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
      // 同一发行版的创建在途：拒绝重复创建（TerminalTabs 双击 / 双入口并发去重）
      // 大小写归一（review 0.1.2 审计修复）：WSL 名不区分大小写，Ubuntu/ubuntu 是同一发行版
      const lower = distro.toLowerCase()
      if (this.creatingDistros.some((d) => d.toLowerCase() === lower)) return null
      // 状态硬门禁（review「启动只能走启动按钮」根治）：终端会话绝不隐式启动发行版。
      // 未启动 → 拒绝并给出行动指引；查不到状态（列表未加载）时放行，交由 wsl 自身报错。
      const known = useDistrosStore().byName(distro)
      if (known && known.state !== 'Running') {
        this.lastError = {
          code: 'DISTRO_NOT_RUNNING',
          message: `发行版 ${known.name} 未运行，无法打开终端`,
          recoverable: true,
          suggestion: '请先在「发行版」列表点「启动」，启动后即可打开终端',
        }
        return null
      }
      if (!this.canCreate) {
        this.lastError = {
          code: 'TASK_FAILED',
          message: `终端会话数已达上限 ${this.maxSessions}`,
          recoverable: true,
          suggestion: '请先关闭部分终端标签',
        }
        return null
      }
      // 同步段占用名额：await 期间其他 open() 会看到 creatingDistros 并拒绝（TOCTOU 封死）
      this.creatingDistros.push(distro)
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
        // 只释放自己的名额（并发不同发行版各自清理，不误删他人）；大小写归一同上
        const i = this.creatingDistros.findIndex((d) => d.toLowerCase() === lower)
        if (i >= 0) this.creatingDistros.splice(i, 1)
      }
    },

    setActive(id: string) {
      if (this.sessions.some((s) => s.ptyId === id)) this.activeId = id
    },

    /**
     * 收编已存在的主进程 PTY 会话（M5 terminal 动作的临时 PTY / 窗口重载恢复）。
     * 不发 pty:create，只登记标签与输出缓冲；保留 adopt 前已到达的数据。
     */
    adopt(ptyId: string, opts: { title?: string; distro: string }): TerminalSession | null {
      const existing = this.sessions.find((s) => s.ptyId === ptyId)
      if (existing) return existing
      const exitCode = pendingExits.get(ptyId)
      pendingExits.delete(ptyId)
      adoptOrphan(ptyId)
      const session: TerminalSession = {
        ptyId,
        title: opts.title?.trim() || opts.distro,
        distro: opts.distro,
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
      if (!buffers.has(id)) rememberOrphan(id)
      let buf = (buffers.get(id) ?? '') + chunk
      if (buf.length > BUFFER_LIMIT) {
        // 按码点边界截断：若截断起点落在「低位代理」上，说明其高位代理已被切掉，
        // 必须再跳过一位，否则缓冲以孤立低代理开头（渲染/导出出伪字符 — review 根治）。
        // 起点是高代理时配对的低位在 slice 内，保留即可（旧实现错删高代理，反而留孤立低代理）。
        let start = buf.length - BUFFER_LIMIT
        const first = buf.charCodeAt(start)
        if (first >= 0xdc00 && first <= 0xdfff) start += 1
        buf = buf.slice(start)
      }
      buffers.set(id, buf)
    },

    handleExit(id: string, code: number) {
      const s = this.sessions.find((x) => x.ptyId === id)
      if (!s) {
        // 退出事件先于 adopt 到达：暂存，adopt 时补终态
        rememberExit(id, code)
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
