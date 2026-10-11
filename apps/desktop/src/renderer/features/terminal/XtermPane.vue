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
import {
  DEFAULT_TERMINAL_PREFS,
  normalizeFontFamily,
  resolveTerminalTheme,
  type TerminalFontPrefs,
} from './theme'
import { chunkTerminalInput } from './input-chunk'
import { errorLine } from '../../composables/useAppError'
import { useSettingsStore } from '../../stores/settings'

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
}>()

const host = ref<HTMLElement | null>(null)
const settings = useSettingsStore()
const message = useMessage()
let term: Terminal | null = null
let fit: FitAddon | null = null
let search: SearchAddon | null = null
let ro: ResizeObserver | null = null
let fitTimer: number | undefined
let unsubs: Array<() => void> = []

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
 */
async function syncPtySize(): Promise<void> {
  if (!term) return
  const want = desiredSize()
  if (want.cols === lastSent.cols && want.rows === lastSent.rows) return
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await window.wslAPI.terminal.resize(props.ptyId, want.cols, want.rows)
      lastSent = want
      return
    } catch (e) {
      if (attempt === 2) {
        message.error(errorLine(e, '终端尺寸同步失败'))
        return
      }
      await new Promise((r) => setTimeout(r, 150))
    }
  }
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
  t.open(host.value)
  if (host.value) host.value.style.background = t.options.theme?.background ?? '#FBFCFE'

  // 恢复历史缓冲后放行实时流（保序：初始缓冲 → 队列 → 直写）
  if (props.initialBuffer) {
    t.write(props.initialBuffer)
  }
  streaming = true
  for (const c of pending) t.write(c)
  pending.length = 0

  doFit()

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
  // 选中即复制（settings.terminal.copyOnSelect）
  t.onSelectionChange(() => {
    if (!settings.terminalCopyOnSelect) return
    const sel = t.getSelection()
    if (sel) void navigator.clipboard.writeText(sel).catch(() => {})
  })

  // 布局稳定：rAF 合并 resize 连发 + 字体加载完成后复位再 fit（度量一致）
  ro = new ResizeObserver(() => scheduleFit())
  ro.observe(host.value)
  void document.fonts?.ready?.then(() => {
    invalidateFit()
    scheduleFit()
  })
})

onBeforeUnmount(() => {
  if (rafFit !== null) {
    cancelAnimationFrame(rafFit)
    rafFit = null
  }
  if (fitTimer !== undefined) {
    window.clearTimeout(fitTimer)
    fitTimer = undefined
  }
  for (const u of unsubs) u()
  unsubs = []
  ro?.disconnect()
  ro = null
  search = null
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

function findNext(text: string) {
  if (!search) return false
  const q = text || lastSearch
  if (!q) return false
  lastSearch = q
  return search.findNext(q)
}

function findPrevious(text: string) {
  if (!search) return false
  const q = text || lastSearch
  if (!q) return false
  lastSearch = q
  return search.findPrevious(q)
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
  zoom,
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
