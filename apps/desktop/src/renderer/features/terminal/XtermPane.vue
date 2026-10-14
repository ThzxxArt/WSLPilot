<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { useMessage } from 'naive-ui'
import { Terminal } from '@xterm/xterm'
// xterm 官方样式必须引入：缺了它内部辅助元素（测量层 / 隐藏 textarea）会以正常流渲染——
// 表现为终端顶部多出 tofu 与重复字符行、并拦截鼠标导致拖选失效、复制误报「请先选中」
import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import {
  DEFAULT_TERMINAL_PREFS,
  normalizeFontFamily,
  resolveTerminalTheme,
  type TerminalFontPrefs,
} from './theme'
import { chunkTerminalInput } from './input-chunk'
import { errorLine } from '../../composables/useAppError'
import { useSettingsStore } from '../../stores/settings'

/** 搜索偏好（0.1.3：大小写 / 正则 / 全部命中高亮） */
export interface SearchPrefs {
  caseSensitive: boolean
  regex: boolean
}

const props = defineProps({
  ptyId: { type: String, required: true },
  prefs: {
    type: Object as PropType<Partial<TerminalFontPrefs>>,
    default: () => ({}),
  },
  /** 挂载时回放的历史输出（切换标签后恢复屏幕） */
  initialBuffer: {
    type: String,
    default: '',
  },
})

const emit = defineEmits<{
  cursorMove: [pos: { col: number; row: number; ptyId: string }]
  /** 终端右键：由父级弹上下文菜单 */
  contextMenu: [payload: { x: number; y: number; ptyId: string }]
  /** Ctrl+Shift+F：请求父级打开搜索框 */
  requestSearch: []
  /** 搜索结果计数变化（null = 无查询） */
  searchResults: [payload: { index: number; count: number }]
  /** 视口是否贴底（「滚动到底部」按钮按需显示） */
  atBottom: [value: boolean]
}>()

const host = ref<HTMLElement | null>(null)
const settings = useSettingsStore()
const message = useMessage()
let term: Terminal | null = null
let fit: FitAddon | null = null
let search: SearchAddon | null = null
let webgl: WebglAddon | null = null
let ro: ResizeObserver | null = null
let unsubs: Array<() => void> = []
/**
 * 组件已卸载：async onMounted 在 `await host()` 期间可能被卸载，
 * 续体必须二次校验，否则会向已置空的 host 调 open()（泄漏 + unhandled rejection — review 0.1.2 根治）。
 */
let disposed = false

function applyPrefs(t: Terminal, p: Partial<TerminalFontPrefs>) {
  const full = { ...DEFAULT_TERMINAL_PREFS, ...p }
  // 含空格的字体名必须补引号，否则 CSS 失配回退到错误字体 → 字形度量错位（review 根治）
  t.options.fontFamily = normalizeFontFamily(full.fontFamily)
  t.options.fontSize = full.fontSize
  t.options.lineHeight = full.lineHeight
  t.options.cursorStyle = full.cursorStyle
  t.options.cursorBlink = full.cursorBlink
  t.options.scrollback = full.scrollback
}

let lastFitW = 0
let lastFitH = 0
let rafFit: number | null = null
/** 上次确认同步到 PTY 的尺寸（带验证的尺寸同步 — review 终端错位根治） */
let lastSent = { cols: 0, rows: 0 }
/** 单飞：并发调用共享同一在途同步，避免重复 resize（review 0.1.2 根治） */
let syncInFlight: Promise<void> | null = null
/** 失败提示节流：同一失败只提示一次，成功同步后重置（review 0.1.2 根治） */
let sizeErrorShown = false

function desiredSize() {
  return {
    cols: Math.min(term?.cols ?? 80, 500),
    rows: Math.min(term?.rows ?? 24, 200),
  }
}

/**
 * 尺寸同步（必达 + 自愈）：PTY 停留在创建默认 80×24 而显示更宽时，
 * ConPTY 会按 80 列折行/填充重绘 → 行截断、碎片错位（review 用户实测根治）。
 * 失败重试 3 次；未同步成功不记账，输出流间隙会再次自愈。
 * 返回本轮是否成功落地（尾沿补偿据此决定是否续飞）。
 */
async function doSyncPtySize(): Promise<boolean> {
  const want = desiredSize()
  if (want.cols === lastSent.cols && want.rows === lastSent.rows) return true
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await window.wslAPI.terminal.resize(props.ptyId, want.cols, want.rows)
      lastSent = want
      sizeErrorShown = false
      return true
    } catch (e) {
      if (attempt === 2) {
        // 同一失败只提示一次：输出流间隙会反复触发自愈，绝不刷屏（review 0.1.2 根治）
        if (!sizeErrorShown) {
          sizeErrorShown = true
          message.error(errorLine(e, '终端尺寸同步失败'))
        }
        return false
      }
      await new Promise((r) => setTimeout(r, 150))
    }
  }
  return false
}

/**
 * 单飞入口：在途同步未完成时直接复用，避免重复 resize（review 0.1.2 根治）。
 * review 0.1.2 审计修复：飞行中到达的新尺寸只复用旧 promise、落地后不复查 drifted，
 * 此后无输出/无 resize 则 PTY 停留旧尺寸（丢尾沿）。根因：单飞缺少尾沿补偿。
 * 修复：成功落地后若仍漂移则再补发一轮（链式收敛于尺寸稳定）；失败轮不补发，
 * 避免 PTY 持续不可用时无限空转（自愈仍由输出间隙兜底）。
 */
function syncPtySize(): Promise<void> {
  if (!term) return Promise.resolve()
  if (syncInFlight) return syncInFlight
  const flight: Promise<void> = doSyncPtySize()
    .then((ok) => {
      syncInFlight = null
      if (ok && !disposed && drifted()) return syncPtySize()
      return undefined
    })
    .catch(() => {
      // 理论不可达（doSyncPtySize 自吞异常）：兜底清空单飞，绝不锁死后续同步
      syncInFlight = null
    })
  syncInFlight = flight
  return flight
}

/** 尺寸漂移检测（输出到达时的零成本校验） */
function drifted() {
  const want = desiredSize()
  return want.cols !== lastSent.cols || want.rows !== lastSent.rows
}

function doFit() {
  try {
    const el = host.value
    if (!el || !term || !fit) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (w < 20 || h < 20) return
    // 尺寸未变不重复 fit：反复 resize(同尺寸) 会触发 ConPTY 多次重绘 → 行错位（review 根治）
    if (w === lastFitW && h === lastFitH) return
    lastFitW = w
    lastFitH = h
    fit.fit()
    // fit 后立刻同步 PTY 尺寸（必达）：不同步则 ConPTY 按旧宽度折行 →错位
    void syncPtySize()
  } catch {
    /* 容器尚未布局 */
  }
}

/** rAF 合并的防抖 fit：ResizeObserver 连发只算一次 */
function scheduleFit() {
  if (rafFit !== null) cancelAnimationFrame(rafFit)
  rafFit = requestAnimationFrame(() => {
    rafFit = null
    doFit()
  })
}

/** 强制下次 fit 生效（字体/偏好变化后度量会变） */
function invalidateFit() {
  lastFitW = 0
  lastFitH = 0
}

/** 距离上限（字节）与 pty:data 一致由分片处理；剪贴板可能含大段文本 */
async function copySelection(): Promise<void> {
  const sel = term?.getSelection() ?? ''
  if (!sel) {
    message.info('请先在终端中选中内容')
    return
  }
  try {
    await window.wslAPI.clipboard.write(sel)
    message.success('已复制')
  } catch (e) {
    message.error(errorLine(e, '复制失败'))
  }
}

/** 粘贴：主进程剪贴板 → 按 IPC 上限分片发送（大段粘贴不丢字 — 0.1.3） */
async function pasteFromClipboard(): Promise<void> {
  let text = ''
  try {
    text = await window.wslAPI.clipboard.read()
  } catch (e) {
    message.error(errorLine(e, '读取剪贴板失败'))
    return
  }
  if (!text) return
  for (const chunk of chunkTerminalInput(text)) {
    try {
      await window.wslAPI.terminal.input(props.ptyId, chunk)
    } catch (e) {
      message.error(errorLine(e, '终端输入发送失败'))
      return
    }
  }
}

function selectAll(): void {
  term?.selectAll()
}

function scrollToBottom(): void {
  term?.scrollToBottom()
}

function isAtBottom(): boolean {
  if (!term) return true
  const buf = term.buffer.active
  return buf.viewportY >= buf.baseY
}

/**
 * WebGL 渲染器（0.1.3）：加载失败或上下文丢失自动回退 DOM 渲染器。
 * 这是纯性能增强——任何失败都不得影响终端可用性（绝不半成品：回退静默且真实生效）。
 */
function tryLoadWebgl(t: Terminal): void {
  try {
    const addon = new WebglAddon()
    addon.onContextLoss(() => {
      try {
        addon.dispose()
      } catch {
        /* ignore */
      }
      if (webgl === addon) webgl = null
    })
    t.loadAddon(addon)
    webgl = addon
  } catch {
    // 无 GPU / 环境不支持：保持默认 DOM 渲染器
    webgl = null
  }
}

/**
 * 终端专属快捷键（xterm attachCustomKeyEventHandler — 0.1.3）：
 * Ctrl+Shift+C 复制 / Ctrl+Shift+V 粘贴 / Ctrl+Shift+F 打开搜索。
 * 必须在 xterm 内部拦截（不能走 window 级快捷键）——终端聚焦时这些组合不发给 shell。
 */
function attachShortcutHandler(t: Terminal): void {
  t.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true
    if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return true
    switch (e.code) {
      case 'KeyC':
        e.preventDefault()
        void copySelection()
        return false
      case 'KeyV':
        e.preventDefault()
        void pasteFromClipboard()
        return false
      case 'KeyF':
        e.preventDefault()
        emit('requestSearch')
        return false
      default:
        return true
    }
  })
}

/** 搜索高亮装饰（浅色主题；命中全部高亮 + 当前命中强调） */
const SEARCH_DECORATIONS = {
  matchBackground: 'rgba(99, 102, 241, 0.18)',
  matchOverviewRuler: 'rgba(99, 102, 241, 0.45)',
  activeMatchBackground: 'rgba(99, 102, 241, 0.45)',
  activeMatchColorOverviewRuler: 'rgba(79, 70, 229, 0.9)',
} as const

function toSearchOptions(prefs?: SearchPrefs) {
  return {
    caseSensitive: prefs?.caseSensitive === true,
    regex: prefs?.regex === true,
    decorations: SEARCH_DECORATIONS,
  }
}

onMounted(async () => {
  if (!host.value) return

  // ── 输出流竞态封死（review 终端丢行根治）──────────────────────
  // initialBuffer 是「渲染期」快照；订阅必须在本函数**同步段**建立（任何 await 之前），
  // 否则 await 间隙到达的 chunk 会丢失 → 屏幕缺行。chunk 先入队，回放完再放行，保序不重。
  const pending: string[] = []
  let streaming = false
  let termRef: Terminal | null = null
  const offData = window.wslAPI.terminal.onData((p) => {
    if (p.ptyId !== props.ptyId) return
    if (!streaming || !termRef) {
      pending.push(p.chunk)
      return
    }
    termRef.write(p.chunk)
    // 尺寸自愈：PTY 停留在旧宽度时 ConPTY 折行会错位——输出间隙零成本校验并拉齐
    if (drifted()) void syncPtySize()
  })
  const offExit = window.wslAPI.terminal.onExit((p) => {
    if (p.ptyId !== props.ptyId) return
    const line = `\r\n\x1b[90m[进程已退出，代码 ${p.code}]\x1b[0m\r\n`
    if (!streaming || !termRef) {
      pending.push(line)
      return
    }
    termRef.write(line)
  })
  unsubs.push(offData, offExit)

  // ── ConPTY 伪影对策（review 终端错位根治）────────────────────
  // xterm 官方 windowsPty：不开启时 ConPTY 重绘（缩放/回滚）会用空行顶掉视口、丢失数据；
  // backend=conpty 且 buildNumber≥21376 才启用完整 reflow 行为（Win10 旧 ConPTY 走保守分支）
  let windowsPty: { backend: 'conpty'; buildNumber: number } | undefined
  try {
    const info = await window.wslAPI.terminal.host()
    if (info?.platform === 'win32' && info.conptyBuild) {
      windowsPty = { backend: 'conpty', buildNumber: info.conptyBuild }
    }
  } catch {
    /* 宿主信息不可用：不启用对策（等价旧行为） */
  }

  // await 期间组件可能已卸载：续体不得再创建 Terminal
  //（否则 host 已置空 → open() 抛错 + 实例无人 dispose 泄漏 — review 0.1.2 根治）
  if (disposed) return

  const t = new Terminal({
    allowProposedApi: true,
    // 真 PTY 数据：不要 convertEol，避免 TUI 光标异常（评审 M2）
    convertEol: false,
    // 显式零字距：与字体度量严格一致，防字符漂移
    letterSpacing: 0,
    theme: resolveTerminalTheme(settings.terminalTheme, settings.accent),
    ...DEFAULT_TERMINAL_PREFS,
    ...(windowsPty ? { windowsPty } : {}),
  })
  applyPrefs(t, props.prefs)
  term = t
  termRef = t
  fit = new FitAddon()
  search = new SearchAddon()
  t.loadAddon(fit)
  t.loadAddon(search)
  t.loadAddon(new WebLinksAddon())
  // Unicode 11 宽字符（中文/emoji 表格不错位）评审 M3
  t.loadAddon(new Unicode11Addon())
  t.unicode.activeVersion = '11'
  // 创建后、open 前最后一次校验（防御性：卸载路径统一 dispose，绝不留孤儿实例）
  if (disposed || !host.value) {
    try {
      t.dispose()
    } catch {
      /* ignore */
    }
    if (term === t) term = null
    if (termRef === t) termRef = null
    return
  }
  t.open(host.value)
  host.value.style.background = t.options.theme?.background ?? '#FBFCFE'
  // 0.1.3：WebGL 渲染器（失败自动回退 DOM）+ 终端专属快捷键 + 搜索计数 + 贴底追踪 + 右键菜单
  tryLoadWebgl(t)
  attachShortcutHandler(t)
  if (search.onDidChangeResults) {
    const off = search.onDidChangeResults((r) =>
      emit('searchResults', { index: r.resultIndex, count: r.resultCount }),
    )
    unsubs.push(() => off.dispose())
  }
  t.onScroll(() => emit('atBottom', isAtBottom()))
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    emit('contextMenu', { x: e.clientX, y: e.clientY, ptyId: props.ptyId })
  }
  host.value.addEventListener('contextmenu', onContextMenu)
  unsubs.push(() => host.value?.removeEventListener('contextmenu', onContextMenu))

  // 恢复历史缓冲后放行实时流（保序：初始缓冲 → 队列 → 直写）
  if (props.initialBuffer) {
    t.write(props.initialBuffer)
  }
  streaming = true
  for (const c of pending) t.write(c)
  pending.length = 0

  doFit()
  emit('atBottom', isAtBottom())

  t.onData((data) => {
    // 超过 IPC 上限的粘贴必须分片（否则 zod 拒绝后输入静默丢失 — review 根治）
    for (const chunk of chunkTerminalInput(data)) {
      void window.wslAPI.terminal.input(props.ptyId, chunk).catch((e: unknown) => {
        message.error(errorLine(e, '终端输入发送失败'))
      })
    }
  })
  t.onResize(() => {
    // 尺寸同步走必达通道（重试 + 记账 + 自愈），夹紧在 syncPtySize 内完成
    void syncPtySize()
  })
  t.onCursorMove(() => {
    emit('cursorMove', {
      col: t.buffer.active.cursorX + 1,
      row: t.buffer.active.cursorY + 1,
      ptyId: props.ptyId,
    })
  })
  // 选中即复制（settings.terminal.copyOnSelect）：走主进程剪贴板（0.1.3 与复制/粘贴同通道）
  t.onSelectionChange(() => {
    if (!settings.terminalCopyOnSelect) return
    const sel = t.getSelection()
    if (sel) void window.wslAPI.clipboard.write(sel).catch(() => {})
  })

  // 布局稳定：rAF 合并 resize 连发 + 字体加载完成后复位再 fit（度量一致）
  ro = new ResizeObserver(() => scheduleFit())
  ro.observe(host.value)
  void document.fonts?.ready?.then(() => {
    // 卸载后的字体就绪续体不得再调度 fit（rAF 泄漏 — review 0.1.2 根治）
    if (disposed) return
    invalidateFit()
    scheduleFit()
  })
})

onBeforeUnmount(() => {
  disposed = true
  if (rafFit !== null) {
    cancelAnimationFrame(rafFit)
    rafFit = null
  }
  for (const u of unsubs) u()
  unsubs = []
  ro?.disconnect()
  ro = null
  search = null
  // 卸载路径统一 dispose（含 async 续体可能已创建的实例）
  try {
    webgl?.dispose()
  } catch {
    /* ignore */
  }
  webgl = null
  try {
    term?.dispose()
  } catch {
    /* ignore */
  }
  term = null
})

watch(
  () => props.prefs,
  (p) => {
    if (term) {
      applyPrefs(term, p)
      // 字体/字号变化 → 度量改变，强制重新 fit（尺寸守卫会误跳过）
      invalidateFit()
      doFit()
      emit('atBottom', isAtBottom())
    }
  },
  { deep: true },
)

// 终端主题跟随设置（auto / follow-app / custom）；容器底色同步跟随
watch(
  () => [settings.terminalTheme, settings.accent] as const,
  () => {
    if (!term) return
    term.options.theme = resolveTerminalTheme(settings.terminalTheme, settings.accent)
    if (host.value) host.value.style.background = term.options.theme?.background ?? '#FBFCFE'
  },
)

function clear() {
  term?.clear()
}

function focus() {
  term?.focus()
}

function fitNow() {
  doFit()
}

function getSelection(): string {
  return term?.getSelection() ?? ''
}

let lastSearch = ''

/** 查找下一个（0.1.3：支持大小写 / 正则，全部命中高亮） */
function findNext(text: string, prefs?: SearchPrefs): boolean {
  if (!search) return false
  const q = text || lastSearch
  if (!q) return false
  lastSearch = q
  return search.findNext(q, toSearchOptions(prefs))
}

function findPrevious(text: string, prefs?: SearchPrefs): boolean {
  if (!search) return false
  const q = text || lastSearch
  if (!q) return false
  lastSearch = q
  return search.findPrevious(q, toSearchOptions(prefs))
}

/** 清除搜索高亮 */
function clearSearch(): void {
  lastSearch = ''
  try {
    search?.clearDecorations()
  } catch {
    /* ignore */
  }
  emit('searchResults', { index: -1, count: 0 })
}

function zoom(delta: number) {
  // 字号统一走 settings：prefs 驱动 term，工具栏显示同步（review M10）
  const current = term?.options.fontSize ?? settings.terminalFontSize
  const next = Math.min(32, Math.max(8, current + delta))
  void settings.setTerminalFontSize(next)
}

defineExpose({
  clear,
  focus,
  fit: fitNow,
  getSelection,
  findNext,
  findPrevious,
  clearSearch,
  zoom,
  copy: copySelection,
  paste: pasteFromClipboard,
  selectAll,
  scrollToBottom,
  isAtBottom,
})
</script>

<template>
  <div ref="host" class="xterm-host" />
</template>

<style scoped>
.xterm-host {
  width: 100%;
  height: 100%;
  min-height: 120px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  background: #fbfcfe;
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
}

.xterm-host :deep(.xterm) {
  height: 100%;
}

/* xterm.css 的 viewport/屏幕默认黑底（#000）强制透明：底色由宿主跟随主题提供 */
.xterm-host :deep(.xterm .xterm-viewport),
.xterm-host :deep(.xterm .xterm-screen) {
  background-color: transparent !important;
}

/* 滚动条跟主题：细滚动条 + 常规配色 */
.xterm-host :deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-default, #cbd5e1) transparent;
}

.xterm-host :deep(.xterm-viewport::-webkit-scrollbar) {
  width: 8px;
  height: 8px;
}

.xterm-host :deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background: var(--color-border-default, #cbd5e1);
  border-radius: 4px;
}

.xterm-host :deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}
</style>
