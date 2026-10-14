import { defineStore } from 'pinia'
import {
  toAppError,
  type AppError,
  type TerminalTabLayout,
  MAX_PTY_SESSIONS,
} from '@wslpilot/shared'
import { useDistrosStore } from './distros'
import { useSettingsStore } from './settings'
import {
  containsLeaf,
  firstLeafId,
  leafIds,
  makeLeaf,
  paneCount,
  pruneLayout,
  removeLeaf,
  setRatioAt,
  splitLeaf,
  MAX_PANES_PER_TAB,
  type PaneDir,
  type PaneNode,
} from '../features/terminal/panes'

/** 单个面板（= 一条 pty 会话）元数据 */
export interface PaneMeta {
  ptyId: string
  distro: string
  /** 实际启动的 shell（pty:create 回报；恢复会话时未知为空串） */
  shell: string
  cwd?: string
  createdAt: number
  alive: boolean
  exitCode?: number
}

/** 一个终端标签：一棵分屏面板树 */
export interface TerminalTab {
  id: string
  title: string
  layout: PaneNode
  createdAt: number
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

/** 会话被收编：脱离孤儿记账，由 closePane/closeTab 正常清理 */
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

/** 布局持久化防抖（ms） */
const LAYOUT_PERSIST_DEBOUNCE_MS = 500
let layoutPersistTimer: ReturnType<typeof setTimeout> | null = null

export const useTerminalStore = defineStore('terminal', {
  state: () => ({
    /** 全部面板（pty）元数据：Record 便于按 ptyId 直查 */
    panes: {} as Record<string, PaneMeta>,
    /** 标签（分屏树容器），顺序即标签栏顺序 */
    tabs: [] as TerminalTab[],
    activeTabId: '' as string,
    /** 活动面板 ptyId（尺寸/光标/工具栏动作的作用对象） */
    activeId: '' as string,
    lastError: null as AppError | null,
    maxSessions: MAX_PTY_SESSIONS as number,
    /** 每标签最近活动面板（切回标签时恢复该面板焦点 — 0.1.3） */
    paneMemory: {} as Record<string, string>,
    /**
     * 创建中的发行版名单（review 0.1.2 TOCTOU 根治）：
     * open() 的「检查上限 → await create → 登记面板」跨越 await，并发调用
     * 会同时通过上限检查从而突破 maxSessions；同一发行版双击也会开两个面板。
     * 在同步段预留名额并做同 distro 去重，跨 await 期间名额不被重复占用。
     */
    creatingDistros: [] as string[],
  }),

  getters: {
    /** 活动面板元数据 */
    activePane: (s): PaneMeta | null => s.panes[s.activeId] ?? null,
    /** 活动标签 */
    activeTab: (s): TerminalTab | null => s.tabs.find((t) => t.id === s.activeTabId) ?? null,
    /** 活动标签可继续分屏（< 4 面板）：store 拒绝 + UI 禁用双保险（0.1.3 审计） */
    canSplit: (s): boolean => {
      const tab = s.tabs.find((t) => t.id === s.activeTabId)
      return !!tab && paneCount(tab.layout) < MAX_PANES_PER_TAB
    },
    /** 存活面板数（会话上限口径） */
    aliveCount: (s): number => Object.values(s.panes).filter((p) => p.alive).length,
    /** 创建中的名额同样计入（否则并发创建绕过上限） */
    canCreate: (s): boolean =>
      Object.values(s.panes).filter((p) => p.alive).length + s.creatingDistros.length <
      s.maxSessions,
    /** 标签存活（任一面板存活即亮） */
    tabAlive:
      (s) =>
      (tabId: string): boolean => {
        const tab = s.tabs.find((t) => t.id === tabId)
        if (!tab) return false
        return leafIds(tab.layout).some((id) => s.panes[id]?.alive === true)
      },
  },

  actions: {
    async loadLimits() {
      try {
        this.maxSessions = (await window.wslAPI.terminal.maxSessions()) || MAX_PTY_SESSIONS
      } catch {
        /* keep default */
      }
    },

    /**
     * 默认启动参数（0.1.3）：`distros.jsonc` 的 startupCwd 与 `settings.wsl.defaultShell`
     * 真正接线到终端创建（此前 startupCwd 只被动作预览消费 — 半幽灵字段根治）。
     */
    defaultOpenOpts(distro: string): { shell?: string; cwd?: string } {
      const settings = useSettingsStore()
      const meta = useDistrosStore().byName(distro)?.meta
      const cwd = meta?.startupCwd?.trim()
      return {
        shell: settings.wslDefaultShell?.trim() || undefined,
        cwd: cwd && cwd !== '~' ? cwd : undefined,
      }
    },

    /**
     * 创建一条 pty 会话（内部共享体）：门禁 / 名额预留 / 去重 / 错误落地。
     * 失败返回 null（lastError 已落地），不抛。
     */
    async createPaneSession(
      distro: string,
      opts: { shell?: string; cwd?: string } = {},
    ): Promise<PaneMeta | null> {
      this.lastError = null
      // 同一发行版的创建在途：拒绝重复创建（双击 / 双入口并发去重）
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
          suggestion: '请先关闭部分终端面板',
        }
        return null
      }
      // 同步段占用名额：await 期间其他创建会看到 creatingDistros 并拒绝（TOCTOU 封死）
      this.creatingDistros.push(distro)
      try {
        const info = await window.wslAPI.terminal.create({
          distro,
          shell: opts.shell,
          cwd: opts.cwd,
          cols: 80,
          rows: 24,
        })
        const meta: PaneMeta = {
          ptyId: info.ptyId,
          distro: info.distro,
          shell: info.shell || opts.shell || '',
          cwd: info.cwd ?? opts.cwd,
          createdAt: info.createdAt ?? Date.now(),
          alive: true,
        }
        buffers.set(meta.ptyId, '')
        adoptOrphan(meta.ptyId)
        this.panes[meta.ptyId] = meta
        this.schedulePersistLayout()
        return meta
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      } finally {
        // 只释放自己的名额（并发不同发行版各自清理，不误删他人）；大小写归一同上
        const i = this.creatingDistros.findIndex((d) => d.toLowerCase() === lower)
        if (i >= 0) this.creatingDistros.splice(i, 1)
      }
    },

    /** 新建标签（默认启动参数）：返回 ptyId；失败返回 null（lastError 已落地） */
    async openDefault(distro: string): Promise<string | null> {
      return this.open(distro, this.defaultOpenOpts(distro))
    },

    /** 新建标签（显式参数）：返回 ptyId；失败返回 null */
    async open(
      distro: string,
      opts: { shell?: string; cwd?: string } = {},
    ): Promise<string | null> {
      const meta = await this.createPaneSession(distro, opts)
      if (!meta) return null
      const tab: TerminalTab = {
        id: meta.ptyId,
        title: distro,
        layout: makeLeaf(meta.ptyId),
        createdAt: meta.createdAt,
      }
      this.tabs.push(tab)
      this.activeTabId = tab.id
      this.activeId = meta.ptyId
      this.paneMemory[tab.id] = meta.ptyId
      this.schedulePersistLayout()
      return meta.ptyId
    },

    /**
     * 在 `paneId` 所在标签内分屏（0.1.3）：新面板继承源面板的发行版 / shell / 启动目录。
     * 返回新 ptyId；失败返回 null（lastError 已落地）。
     */
    async splitPane(paneId: string, dir: PaneDir): Promise<string | null> {
      this.lastError = null
      const source = this.panes[paneId]
      if (!source) return null
      const tab = this.tabs.find((t) => containsLeaf(t.layout, paneId))
      if (!tab) return null
      if (paneCount(tab.layout) >= MAX_PANES_PER_TAB) {
        this.lastError = {
          code: 'TASK_FAILED',
          message: `单个标签最多 ${MAX_PANES_PER_TAB} 个面板`,
          recoverable: true,
          suggestion: '请先关闭部分面板，或新建一个标签',
        }
        return null
      }
      const created = await this.createPaneSession(source.distro, {
        shell: source.shell || undefined,
        cwd: source.cwd,
      })
      if (!created) return null
      const layout = splitLeaf(tab.layout, paneId, created.ptyId, dir)
      if (!layout) {
        // 理论不可达（源面板刚校验存在）：回滚已建会话，绝不留孤儿 pty
        try {
          void window.wslAPI.terminal.kill(created.ptyId).catch(() => {})
        } catch {
          /* ignore */
        }
        delete this.panes[created.ptyId]
        buffers.delete(created.ptyId)
        return null
      }
      tab.layout = layout
      this.activeId = created.ptyId
      this.activeTabId = tab.id
      this.paneMemory[tab.id] = created.ptyId
      this.schedulePersistLayout()
      return created.ptyId
    },

    /** 分屏活动面板（快捷键 / 命令面板入口） */
    async splitActive(dir: PaneDir): Promise<string | null> {
      if (!this.activeId) return null
      return this.splitPane(this.activeId, dir)
    },

    /** 关闭单个面板（kill 失败保留面板并抛出，由调用方提示） */
    async closePane(paneId: string): Promise<void> {
      const tab = this.tabs.find((t) => containsLeaf(t.layout, paneId))
      try {
        await window.wslAPI.terminal.kill(paneId)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
      delete this.panes[paneId]
      buffers.delete(paneId)
      if (!tab) {
        // 不在任何标签（异常路径）：会话已杀，重算活动
        this.reassignActive()
        this.schedulePersistLayout()
        return
      }
      const next = removeLeaf(tab.layout, paneId)
      if (!next) {
        // 最后一个面板：标签整体移除（已杀，不需要再 kill）
        this.removeTabLocal(tab.id)
      } else {
        tab.layout = next
        if (this.activeId === paneId) this.activeId = this.pickPane(tab)
        this.paneMemory[tab.id] = this.activeId
      }
      this.schedulePersistLayout()
    },

    /** 关闭标签（其内全部面板） */
    async closeTab(tabId: string): Promise<void> {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) return
      const ids = leafIds(tab.layout)
      for (const id of ids) {
        try {
          await window.wslAPI.terminal.kill(id)
        } catch (e) {
          this.lastError = toAppError(e)
          throw this.lastError
        }
      }
      for (const id of ids) {
        delete this.panes[id]
        buffers.delete(id)
      }
      this.removeTabLocal(tabId)
      this.schedulePersistLayout()
    },

    /** 本地移除标签记录并重算活动（pty 已处理，纯状态操作） */
    removeTabLocal(tabId: string) {
      const idx = this.tabs.findIndex((t) => t.id === tabId)
      if (idx < 0) return
      this.tabs.splice(idx, 1)
      delete this.paneMemory[tabId]
      if (this.activeTabId === tabId) {
        const next = this.tabs[Math.min(idx, this.tabs.length - 1)]
        this.activeTabId = next?.id ?? ''
        this.activeId = next ? this.pickPane(next) : ''
      }
      this.reassignActive()
    },

    /** 选择标签内焦点面板：优先「最近活动记忆」，失效则首面板 */
    pickPane(tab: TerminalTab): string {
      const remembered = this.paneMemory[tab.id]
      if (remembered && containsLeaf(tab.layout, remembered)) return remembered
      return firstLeafId(tab.layout)
    },

    /** 活动指针自愈：指向不存在的面板时回退到活动标签的首面板 */
    reassignActive() {
      if (this.activeId && this.panes[this.activeId]) return
      const tab = this.activeTab ?? this.tabs[0]
      this.activeTabId = tab?.id ?? ''
      this.activeId = tab ? this.pickPane(tab) : ''
      if (tab) this.paneMemory[tab.id] = this.activeId
    },

    setActivePane(ptyId: string) {
      if (!this.panes[ptyId]) return
      this.activeId = ptyId
      const tab = this.tabs.find((t) => containsLeaf(t.layout, ptyId))
      if (tab) {
        this.activeTabId = tab.id
        this.paneMemory[tab.id] = ptyId
      }
    },

    setActiveTab(tabId: string) {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) return
      this.activeTabId = tabId
      // 保留「该标签内上一次的面板」为活动（paneMemory）；若失效则取首面板
      if (!containsLeaf(tab.layout, this.activeId)) {
        this.activeId = this.pickPane(tab)
      }
      this.paneMemory[tab.id] = this.activeId
    },

    /**
     * 收编已存在的主进程 PTY 会话（M5 terminal 动作的临时 PTY / 窗口重载恢复）。
     * 不发 pty:create，只登记面板与输出缓冲；保留 adopt 前已到达的数据。
     */
    adopt(
      ptyId: string,
      opts: { title?: string; distro: string; shell?: string; cwd?: string; createdAt?: number },
    ): PaneMeta | null {
      if (this.panes[ptyId]) return this.panes[ptyId]!
      const exitCode = pendingExits.get(ptyId)
      pendingExits.delete(ptyId)
      adoptOrphan(ptyId)
      const meta: PaneMeta = {
        ptyId,
        distro: opts.distro,
        shell: opts.shell ?? '',
        cwd: opts.cwd,
        // 恢复路径传入主进程会话的真实创建时间（无则取当前时刻）
        createdAt: opts.createdAt ?? Date.now(),
        alive: exitCode === undefined,
      }
      if (exitCode !== undefined) meta.exitCode = exitCode
      // adopt 前到达的输出不丢（竞态防护）
      if (!buffers.has(ptyId)) buffers.set(ptyId, '')
      this.panes[ptyId] = meta
      // 独立标签（动作临时 PTY 不参与分屏）
      const tab: TerminalTab = {
        id: ptyId,
        title: opts.title?.trim() || opts.distro,
        layout: makeLeaf(ptyId),
        createdAt: meta.createdAt,
      }
      this.tabs.push(tab)
      this.activeTabId = tab.id
      this.activeId = ptyId
      this.paneMemory[tab.id] = ptyId
      this.schedulePersistLayout()
      return meta
    },

    /**
     * 恢复主进程中仍存活的会话（窗口刷新 / 重载后找回终端标签与分屏结构）。
     * - 先尝试按 `ui-state.terminalLayout` 恢复分屏（丢弃已死叶子并折叠）；
     * - 未覆盖到的存活会话退化为独立标签；
     * - 静默失败：无法连接主进程时保持空列表即可。
     */
    async recover(): Promise<void> {
      try {
        const infos = await window.wslAPI.terminal.list()
        if (!infos || infos.length === 0) return
        const byId = new Map(infos.map((i) => [i.ptyId, i]))
        const aliveIds = new Set(byId.keys())
        let saved: TerminalTabLayout[] = []
        try {
          const ui = await window.wslAPI.config.get('uiState')
          saved = Array.isArray(ui.terminalLayout) ? ui.terminalLayout : []
        } catch {
          saved = []
        }
        const consumed = new Set<string>()
        for (const entry of saved) {
          const layout = pruneLayout(entry?.layout, aliveIds)
          if (!layout) continue
          const ids = leafIds(layout)
          if (ids.some((id) => consumed.has(id) || this.panes[id])) continue
          ids.forEach((id) => consumed.add(id))
          const tab: TerminalTab = {
            id: typeof entry.id === 'string' && entry.id ? entry.id : ids[0]!,
            title: typeof entry.title === 'string' ? entry.title : '',
            layout,
            createdAt: Date.now(),
          }
          this.tabs.push(tab)
          for (const id of ids) {
            const info = byId.get(id)!
            adoptOrphan(id)
            if (!buffers.has(id)) buffers.set(id, '')
            this.panes[id] = {
              ptyId: id,
              distro: info.distro,
              shell: info.shell ?? '',
              cwd: info.cwd,
              createdAt: info.createdAt ?? Date.now(),
              alive: true,
            }
          }
        }
        // 未被布局覆盖的存活会话：独立标签
        for (const info of infos) {
          if (consumed.has(info.ptyId) || this.panes[info.ptyId]) continue
          this.adopt(info.ptyId, {
            title: info.distro,
            distro: info.distro,
            shell: info.shell,
            cwd: info.cwd,
            createdAt: info.createdAt,
          })
        }
        // 活动指针校正
        const firstTab = this.tabs[0]
        if (!this.tabs.some((t) => t.id === this.activeTabId)) {
          this.activeTabId = firstTab?.id ?? ''
          this.activeId = firstTab ? firstLeafId(firstTab.layout) : ''
        }
      } catch {
        /* 恢复失败不影响主流程 */
      }
    },

    rename(tabId: string, title: string) {
      const tab = this.tabs.find((x) => x.id === tabId)
      if (tab && title.trim()) {
        tab.title = title.trim().slice(0, 80)
        this.schedulePersistLayout()
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
      const pane = this.panes[id]
      if (!pane) {
        // 退出事件先于 adopt 到达：暂存，adopt 时补终态
        rememberExit(id, code)
        return
      }
      pane.alive = false
      pane.exitCode = code
    },

    moveTab(from: number, to: number) {
      if (from === to) return
      const arr = this.tabs
      if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item!)
      this.schedulePersistLayout()
    },

    /** 设置某个 split 的比例（分割条拖拽） */
    setRatio(tabId: string, path: readonly ('a' | 'b')[], ratio: number) {
      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) return
      tab.layout = setRatioAt(tab.layout, path, ratio)
      this.schedulePersistLayout()
    },

    /** 持久化布局快照（只含当前存在的面板） */
    layoutSnapshot(): TerminalTabLayout[] {
      return this.tabs.map((t) => ({ id: t.id, title: t.title, layout: t.layout }))
    },

    /** 防抖持久化分屏布局到 ui-state.jsonc（窗口重载恢复用） */
    schedulePersistLayout() {
      if (typeof window === 'undefined' || !window.wslAPI?.config) return
      if (layoutPersistTimer) clearTimeout(layoutPersistTimer)
      layoutPersistTimer = setTimeout(() => {
        layoutPersistTimer = null
        const snapshot = this.layoutSnapshot()
        void window.wslAPI.config.set('uiState', { terminalLayout: snapshot }).catch(() => {
          /* 布局持久化失败不影响会话 */
        })
      }, LAYOUT_PERSIST_DEBOUNCE_MS)
    },
  },
})
