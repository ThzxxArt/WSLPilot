<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NDropdown, useMessage } from 'naive-ui'
import { EmptyState } from '@wslpilot/ui'
import { useRoute } from 'vue-router'
import { useTerminalStore } from '../stores/terminal'
import { useDistrosStore } from '../stores/distros'
import { useSettingsStore } from '../stores/settings'
import { errorLine } from '../composables/useAppError'
import TerminalTabs, { type TerminalTabItem } from '../features/terminal/TerminalTabs.vue'
import TerminalToolbar from '../features/terminal/TerminalToolbar.vue'
import XtermPane from '../features/terminal/XtermPane.vue'
import { DEFAULT_TERMINAL_PREFS, type TerminalFontPrefs } from '../features/terminal/theme'
import {
  leafIds,
  paneCount,
  layoutRects,
  layoutDividers,
  type PaneRect,
  type PaneDividerPlacement,
} from '../features/terminal/panes'

// KeepAlive include 按组件名匹配；script setup 必须显式命名
defineOptions({ name: 'TerminalView' })

const route = useRoute()
const terminal = useTerminalStore()
const distros = useDistrosStore()
const settings = useSettingsStore()
const message = useMessage()

/** 每个 ptyId 一个 XtermPane 实例（跨标签/分屏保活，切活动不丢现场） */
const paneRefs = new Map<string, InstanceType<typeof XtermPane>>()
const toolbarRef = ref<InstanceType<typeof TerminalToolbar> | null>(null)
const cursorPos = ref({ col: 1, row: 1 })
const elapsed = ref('00:00')
const lastQuery = ref('')
const lastPrefs = ref({ caseSensitive: false, regex: false })
const searchState = ref({ index: -1, count: 0 })
const atBottom = ref(true)
const panesEl = ref<HTMLElement | null>(null)
let timer: number | undefined
/** 分屏拖拽的 window 监听清理（拖拽中切路由/卸载时兜底） */
let dividerDragCleanup: (() => void) | null = null

function setPaneRef(id: string, el: unknown) {
  if (el) paneRefs.set(id, el as InstanceType<typeof XtermPane>)
  else paneRefs.delete(id)
}

function activePane() {
  return paneRefs.get(terminal.activeId) ?? null
}

const prefs = computed<TerminalFontPrefs>(() => ({
  ...DEFAULT_TERMINAL_PREFS,
  fontFamily: settings.terminalFontFamily,
  fontSize: settings.terminalFontSize,
  lineHeight: settings.terminalLineHeight,
  cursorStyle: settings.terminalCursorStyle,
  cursorBlink: settings.terminalCursorBlink,
  scrollback: settings.terminalScrollback,
}))

/** 终端只服务运行中发行版（review 状态门禁）：下拉与默认目标都只取 Running */
const runningDistros = computed(() => distros.items.filter((d) => d.state === 'Running'))

const distroOptions = computed(() =>
  runningDistros.value.map((d) => ({
    label: d.meta?.alias || d.name,
    value: d.name,
  })),
)

const defaultDistro = computed(() => {
  const q = route.query.distro
  if (typeof q === 'string' && q) return q
  const running = runningDistros.value
  const def = running.find((d) => d.isDefault) ?? running[0]
  return def?.name ?? ''
})

const defaultShell = computed(() => settings.wslDefaultShell?.trim() || '/bin/bash')

/** 面板矩形 → 绝对定位样式（扁平渲染：pty 实例不随 split 重建） */
function rectStyle(r: PaneRect): Record<string, string> {
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  }
}

/** 分割条位置：row 竖线 / col 横线，均以父矩形比例换算 */
function dividerStyle(d: PaneDividerPlacement): Record<string, string> {
  if (d.dir === 'row') {
    return {
      left: `calc(${(d.parent.x + d.parent.w * d.ratio) * 100}% - 3px)`,
      top: `${d.parent.y * 100}%`,
      width: '6px',
      height: `${d.parent.h * 100}%`,
    }
  }
  return {
    left: `${d.parent.x * 100}%`,
    top: `calc(${(d.parent.y + d.parent.h * d.ratio) * 100}% - 3px)`,
    width: `${d.parent.w * 100}%`,
    height: '6px',
  }
}

/** 拖拽分割条：按父矩形换算比例，夹取交给 store 的 setRatio */
function onDividerDown(tabId: string, d: PaneDividerPlacement, e: PointerEvent) {
  e.preventDefault()
  const container = panesEl.value
  if (!container) return
  dividerDragCleanup?.()
  const rect = container.getBoundingClientRect()
  const px = rect.left + d.parent.x * rect.width
  const py = rect.top + d.parent.y * rect.height
  const pw = Math.max(1, d.parent.w * rect.width)
  const ph = Math.max(1, d.parent.h * rect.height)
  const move = (ev: PointerEvent) => {
    const ratio = d.dir === 'row' ? (ev.clientX - px) / pw : (ev.clientY - py) / ph
    terminal.setRatio(tabId, d.path, ratio)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    dividerDragCleanup = null
  }
  dividerDragCleanup = up
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/** 时间 HH:mm:ss（标签悬浮提示用；本地时区） */
function timeOf(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 标签栏数据（含悬浮提示：发行版 / shell / 目录 / 创建时间 — 0.1.3） */
const tabItems = computed<TerminalTabItem[]>(() =>
  terminal.tabs.map((t) => {
    const ids = leafIds(t.layout)
    const first = terminal.panes[ids[0]!]
    const tooltip = [
      first?.distro || t.title,
      first?.shell,
      first?.cwd,
      first?.createdAt ? `创建 ${timeOf(first.createdAt)}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    return {
      id: t.id,
      title: t.title,
      alive: ids.some((id) => terminal.panes[id]?.alive === true),
      tooltip,
    }
  }),
)

const activeTabPaneCount = computed(() =>
  terminal.activeTab ? paneCount(terminal.activeTab.layout) : 0,
)

function tickElapsed() {
  const s = terminal.activePane
  if (!s) {
    elapsed.value = '00:00'
    return
  }
  const sec = Math.floor((Date.now() - s.createdAt) / 1000)
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  elapsed.value = `${m}:${ss}`
}

function startTimer() {
  if (timer) window.clearInterval(timer)
  timer = window.setInterval(tickElapsed, 1000)
}

onMounted(async () => {
  await Promise.all([distros.refresh(), terminal.loadLimits()])
  // query 意图优先（review M1）：已有该发行版会话则激活，否则新建
  const wanted = route.query.distro
  if (typeof wanted === 'string' && wanted) {
    await openOrActivate(wanted)
  } else if (terminal.tabs.length === 0 && defaultDistro.value) {
    await create(defaultDistro.value)
  } else if (!terminal.activeTabId && terminal.tabs.length > 0) {
    terminal.setActiveTab(terminal.tabs[0]!.id)
  }
  startTimer()
})

/**
 * KeepAlive 恢复：路由切回终端时不重建 xterm，但需要重新 fit（隐藏期间尺寸为 0），
 * 并确保 query 意图仍被处理（deactivated 期间 watcher 也会跑，openOrActivate 幂等）。
 */
onActivated(() => {
  startTimer()
  const wanted = route.query.distro
  if (typeof wanted === 'string' && wanted) void openOrActivate(wanted)
  requestAnimationFrame(() => {
    activePane()?.fit()
    activePane()?.focus()
  })
})

onDeactivated(() => {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
  dividerDragCleanup?.()
  dividerDragCleanup = null
})

/** 同名发行版开标签请求去重：query 快速切换 / 双入口并发时防双开（review 并发竞态） */
const opening = new Map<string, Promise<void>>()

/** 已有会话则激活（键大小写归一 — review 0.1.2）；0.1.3：在分屏面板中查找并激活所在标签 */
async function openOrActivate(distro: string) {
  const key = distro.toLowerCase()
  const tab = terminal.tabs.find((t) =>
    leafIds(t.layout).some((id) => (terminal.panes[id]?.distro ?? '').toLowerCase() === key),
  )
  if (tab) {
    terminal.setActiveTab(tab.id)
    const leaf = leafIds(tab.layout).find(
      (id) => (terminal.panes[id]?.distro ?? '').toLowerCase() === key,
    )
    if (leaf) terminal.setActivePane(leaf)
    return
  }
  const inflight = opening.get(key)
  if (inflight) {
    await inflight
    return
  }
  const p = create(distro).finally(() => opening.delete(key))
  opening.set(key, p)
  await p
}

watch(
  () => route.query.distro,
  async (d: unknown) => {
    if (typeof d === 'string' && d) {
      await openOrActivate(d)
    }
  },
)

watch(
  () => terminal.activeId,
  () => {
    cursorPos.value = { col: 1, row: 1 }
    searchState.value = { index: -1, count: 0 }
    atBottom.value = activePane()?.isAtBottom() ?? true
    // 激活面板后重新 fit（v-show 隐藏时尺寸可能为 0）并聚焦
    requestAnimationFrame(() => {
      activePane()?.fit()
      activePane()?.focus()
    })
  },
)

/** 新建标签（字符串 = 仅发行版；对象 = 携带 Shell/目录，0.1.3） */
async function create(payload: string | { distro: string; shell?: string; cwd?: string }) {
  const p = typeof payload === 'string' ? { distro: payload } : payload
  const defaults = terminal.defaultOpenOpts(p.distro)
  const id = await terminal.open(p.distro, {
    shell: p.shell || defaults.shell,
    cwd: p.cwd || defaults.cwd,
  })
  if (!id && terminal.lastError) {
    message.error(errorLine(terminal.lastError))
  }
}

async function closeTab(id: string) {
  try {
    await terminal.closeTab(id)
    message.success('终端标签已关闭')
  } catch (e) {
    message.error(errorLine(e, '关闭终端失败'))
  }
}

async function closePane() {
  if (!terminal.activeId) return
  try {
    await terminal.closePane(terminal.activeId)
  } catch (e) {
    message.error(errorLine(e, '关闭面板失败'))
  }
}

async function split(dir: 'row' | 'col') {
  const id = await terminal.splitActive(dir)
  if (!id && terminal.lastError) message.error(errorLine(terminal.lastError))
}

function onRename(id: string, title: string) {
  terminal.rename(id, title)
}

function onReorder(from: number, to: number) {
  terminal.moveTab(from, to)
}

function onClear() {
  activePane()?.clear()
}

function onCopy() {
  void activePane()?.copy()
}

function onPaste() {
  void activePane()?.paste()
}

function onScrollBottom() {
  activePane()?.scrollToBottom()
  atBottom.value = true
}

function onExport() {
  const pane = terminal.activePane
  const tab = terminal.activeTab
  if (!pane || !tab) {
    // 无会话时不再静默 return（按钮虽已禁用，事件路径也要如实提示）
    message.warning('没有活动的终端会话，无法导出')
    return
  }
  const blob = new Blob([terminal.getBuffer(pane.ptyId)], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const safe = tab.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  a.download = `${safe}-${Date.now()}.log`
  a.click()
  URL.revokeObjectURL(a.href)
  message.success('会话已导出')
}

function onSearch(payload: { query: string; caseSensitive: boolean; regex: boolean }) {
  lastQuery.value = payload.query
  lastPrefs.value = { caseSensitive: payload.caseSensitive, regex: payload.regex }
  const ok = activePane()?.findNext(payload.query, lastPrefs.value)
  if (!ok) message.info('未找到匹配')
}

function onSearchNext() {
  if (!lastQuery.value) {
    message.info('请先输入搜索词并回车')
    return
  }
  activePane()?.findNext(lastQuery.value, lastPrefs.value)
}

function onSearchPrev() {
  if (!lastQuery.value) {
    message.info('请先输入搜索词并回车')
    return
  }
  activePane()?.findPrevious(lastQuery.value, lastPrefs.value)
}

function onSearchClose() {
  lastQuery.value = ''
  searchState.value = { index: -1, count: 0 }
  activePane()?.clearSearch()
}

function onSearchResults(ptyId: string, payload: { index: number; count: number }) {
  if (ptyId !== terminal.activeId) return
  searchState.value = payload
}

function onAtBottom(ptyId: string, value: boolean) {
  if (ptyId !== terminal.activeId) return
  atBottom.value = value
}

function onZoom(delta: number) {
  activePane()?.zoom(delta)
}

function onCursorMove(pos: { col: number; row: number; ptyId?: string }) {
  // 后台面板的光标移动不得污染状态栏坐标（review M11）
  if (pos.ptyId && pos.ptyId !== terminal.activeId) return
  cursorPos.value = { col: pos.col, row: pos.row }
}

function onRequestSearch() {
  void toolbarRef.value?.openSearch()
}

// ── 面板右键菜单（0.1.3）──
const menu = ref({ show: false, x: 0, y: 0, paneId: '' })

function onPaneContextMenu(payload: { x: number; y: number; ptyId: string }) {
  menu.value = { show: true, x: payload.x, y: payload.y, paneId: payload.ptyId }
  // 右键即聚焦该面板（后续工具栏动作作用于它）
  terminal.setActivePane(payload.ptyId)
}

const menuOptions = computed(() => [
  { label: '复制', key: 'copy' },
  { label: '粘贴', key: 'paste' },
  { label: '全选', key: 'selectAll' },
  { label: '查找…', key: 'find' },
  { type: 'divider', key: 'd1' },
  { label: '清屏', key: 'clear' },
  { label: '滚动到底部', key: 'bottom' },
  { type: 'divider', key: 'd2' },
  { label: '左右分屏', key: 'splitRow', disabled: !terminal.canSplit },
  { label: '上下分屏', key: 'splitCol', disabled: !terminal.canSplit },
  { type: 'divider', key: 'd3' },
  { label: '关闭面板', key: 'closePane' },
])

function onMenuSelect(key: string) {
  menu.value.show = false
  const pane = paneRefs.get(menu.value.paneId)
  switch (key) {
    case 'copy':
      void pane?.copy()
      break
    case 'paste':
      void pane?.paste()
      break
    case 'selectAll':
      pane?.selectAll()
      break
    case 'find':
      void toolbarRef.value?.openSearch()
      break
    case 'clear':
      pane?.clear()
      break
    case 'bottom':
      pane?.scrollToBottom()
      break
    case 'splitRow':
      void terminal.splitPane(menu.value.paneId, 'row').then((id) => {
        if (!id && terminal.lastError) message.error(errorLine(terminal.lastError))
      })
      break
    case 'splitCol':
      void terminal.splitPane(menu.value.paneId, 'col').then((id) => {
        if (!id && terminal.lastError) message.error(errorLine(terminal.lastError))
      })
      break
    case 'closePane':
      void terminal.closePane(menu.value.paneId).catch((e: unknown) => {
        message.error(errorLine(e, '关闭面板失败'))
      })
      break
  }
}

// PTY 输出/退出订阅在 App.vue 应用级常驻（评审 I1）
onUnmounted(() => {
  // 保留 store 中的 buffer；不在此解绑全局订阅
})
</script>

<template>
  <div class="terminal-view">
    <header class="page-header">
      <div>
        <h1>终端</h1>
        <p class="sub">
          node-pty + xterm.js · 会话 {{ terminal.aliveCount }}/{{ terminal.maxSessions }}
          <template v-if="terminal.activePane"> · {{ terminal.activePane.distro }} </template>
          <template v-if="activeTabPaneCount > 1"> · 面板 {{ activeTabPaneCount }} </template>
        </p>
      </div>
    </header>

    <TerminalTabs
      :tabs="tabItems"
      :active-tab-id="terminal.activeTabId"
      :max-sessions="terminal.maxSessions"
      :distro-options="distroOptions"
      :default-distro="defaultDistro"
      :default-shell="defaultShell"
      :creating-distros="terminal.creatingDistros"
      @create="create"
      @select="terminal.setActiveTab"
      @close="closeTab"
      @rename="onRename"
      @reorder="onReorder"
    />

    <div class="toolbar-row">
      <TerminalToolbar
        ref="toolbarRef"
        :can-zoom="!!terminal.activePane"
        :has-session="!!terminal.activePane"
        :can-split="terminal.canSplit"
        :font-size="prefs.fontSize"
        :at-bottom="atBottom"
        :search-count="searchState.count"
        :search-index="searchState.index"
        @clear="onClear"
        @search="onSearch"
        @search-next="onSearchNext"
        @search-prev="onSearchPrev"
        @search-close="onSearchClose"
        @copy="onCopy"
        @paste="onPaste"
        @export="onExport"
        @zoom="onZoom"
        @scroll-bottom="onScrollBottom"
        @split-row="split('row')"
        @split-col="split('col')"
        @close-pane="closePane"
      />
    </div>

    <div ref="panesEl" class="panes">
      <!--
        扁平保活（0.1.4）：所有标签的叶子都按 ptyId 渲染为独立绝对定位 host，
        分屏只改变矩形、不改变组件树位置 —— 因此 split/close 不会销毁已有 xterm。
      -->
      <div
        v-for="tab in terminal.tabs"
        v-show="tab.id === terminal.activeTabId"
        :key="tab.id"
        class="tab-panes"
      >
        <div
          v-for="p in layoutRects(tab.layout)"
          :key="p.ptyId"
          class="pane-host"
          :class="{ active: p.ptyId === terminal.activeId }"
          :style="rectStyle(p)"
          @mousedown.capture="terminal.setActivePane(p.ptyId)"
        >
          <XtermPane
            :ref="(el) => setPaneRef(p.ptyId, el)"
            :pty-id="p.ptyId"
            :prefs="prefs"
            :initial-buffer="terminal.getBuffer(p.ptyId)"
            @cursor-move="onCursorMove"
            @request-search="onRequestSearch"
            @search-results="(payload) => onSearchResults(p.ptyId, payload)"
            @at-bottom="(v) => onAtBottom(p.ptyId, v)"
            @context-menu="onPaneContextMenu"
          />
        </div>
        <div
          v-for="d in layoutDividers(tab.layout)"
          :key="d.path.join('.') || 'root'"
          class="pane-divider"
          :class="d.dir"
          role="separator"
          :aria-label="d.dir === 'row' ? '左右分屏分隔条' : '上下分屏分隔条'"
          :style="dividerStyle(d)"
          @pointerdown="onDividerDown(tab.id, d, $event)"
        />
      </div>

      <EmptyState
        v-if="terminal.tabs.length === 0"
        description="还没有终端会话"
        illustration="🖥️"
        class="empty"
      >
        <n-button type="primary" :disabled="!defaultDistro" @click="create(defaultDistro)">
          打开 {{ defaultDistro || '终端' }}
        </n-button>
      </EmptyState>
    </div>

    <footer class="status">
      <span>行 {{ cursorPos.row }} · 列 {{ cursorPos.col }}</span>
      <span>UTF-8</span>
      <span>会话时长 {{ elapsed }}</span>
      <span v-if="terminal.activePane && !terminal.activePane.alive" class="dead">
        已退出（代码 {{ terminal.activePane.exitCode }}）
      </span>
    </footer>

    <!-- 面板右键菜单（x/y 定位；manual 触发） -->
    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="menu.show"
      :x="menu.x"
      :y="menu.y"
      :options="menuOptions"
      @select="onMenuSelect"
      @clickoutside="menu.show = false"
    />
  </div>
</template>

<style scoped>
.terminal-view {
  padding: 16px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 1400px;
  margin: 0 auto;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}

.page-header h1 {
  font-size: 22px;
  font-weight: 650;
  margin: 0;
  color: var(--color-text-primary);
}

.sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.toolbar-row {
  display: flex;
  justify-content: flex-end;
}

.panes {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tab-panes {
  position: relative;
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

/* 扁平 pane host：绝对定位，XtermPane 实例按 ptyId 保活 */
.pane-host {
  position: absolute;
  min-width: 0;
  min-height: 0;
  display: flex;
  border-radius: var(--radius-md);
  outline: 1px solid transparent;
  transition: outline-color var(--dur-fast) var(--ease-standard);
}

.pane-host.active {
  outline-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
}

.pane-host > :deep(*) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* 分割条覆盖在 pane 之上；row=竖线，col=横线 */
.pane-divider {
  position: absolute;
  z-index: 2;
  background: var(--color-border-subtle);
  border-radius: 999px;
  transition: background var(--dur-fast) var(--ease-standard);
}

.pane-divider.row {
  cursor: col-resize;
}

.pane-divider.col {
  cursor: row-resize;
}

.pane-divider:hover {
  background: var(--color-accent);
}

.empty {
  margin: auto;
}

.status {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  padding: 4px 2px;
  flex-shrink: 0;
}

.dead {
  color: var(--color-warning);
}
</style>
