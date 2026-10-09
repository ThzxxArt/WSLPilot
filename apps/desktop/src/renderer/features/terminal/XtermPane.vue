<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { TERMINAL_LIGHT_THEME, type TerminalFontPrefs, DEFAULT_TERMINAL_PREFS } from './theme'

const props = defineProps({
  ptyId: { type: String, required: true },
  prefs: {
    type: Object as PropType<Partial<TerminalFontPrefs>>,
    default: () => ({}),
  },
})

const emit = defineEmits<{
  ready: [term: Terminal]
  exit: [code: number]
}>()

const host = ref<HTMLElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let search: SearchAddon | null = null
let ro: ResizeObserver | null = null
let unsubs: Array<() => void> = []

function applyPrefs(t: Terminal, p: Partial<TerminalFontPrefs>) {
  const full = { ...DEFAULT_TERMINAL_PREFS, ...p }
  t.options.fontFamily = full.fontFamily
  t.options.fontSize = full.fontSize
  t.options.lineHeight = full.lineHeight
  t.options.cursorStyle = full.cursorStyle
  t.options.cursorBlink = full.cursorBlink
  t.options.scrollback = full.scrollback
}

function doFit() {
  try {
    fit?.fit()
  } catch {
    /* 容器尚未布局 */
  }
}

onMounted(() => {
  if (!host.value) return
  const t = new Terminal({
    allowProposedApi: true,
    convertEol: true,
    theme: { ...TERMINAL_LIGHT_THEME },
    ...DEFAULT_TERMINAL_PREFS,
  })
  applyPrefs(t, props.prefs)
  term = t
  fit = new FitAddon()
  search = new SearchAddon()
  t.loadAddon(fit)
  t.loadAddon(search)
  t.loadAddon(new WebLinksAddon())
  t.open(host.value)
  doFit()

  // 用户输入 → PTY
  t.onData((data) => {
    void window.wslAPI.terminal.input(props.ptyId, data)
  })
  t.onResize(({ cols, rows }) => {
    void window.wslAPI.terminal.resize(props.ptyId, cols, rows)
  })

  // PTY 输出 → xterm
  const offData = window.wslAPI.terminal.onData((p) => {
    if (p.ptyId !== props.ptyId) return
    t.write(p.chunk)
    emit('ready', t) // 幂等信号，父组件可忽略
  })
  const offExit = window.wslAPI.terminal.onExit((p) => {
    if (p.ptyId !== props.ptyId) return
    t.write(`\r\n\x1b[90m[进程已退出，代码 ${p.code}]\x1b[0m\r\n`)
    emit('exit', p.code)
  })
  unsubs.push(offData, offExit)

  ro = new ResizeObserver(() => doFit())
  ro.observe(host.value)

  // 末次 fit（字体加载后）
  setTimeout(doFit, 50)
  emit('ready', t)
})

onBeforeUnmount(() => {
  for (const u of unsubs) u()
  unsubs = []
  ro?.disconnect()
  ro = null
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
      doFit()
    }
  },
  { deep: true },
)

// ── 公开 API ──────────────────────────────────────────────
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

function write(data: string) {
  term?.write(data)
}

function findNext(text: string) {
  if (!text || !search) return false
  return search.findNext(text)
}

function findPrevious(text: string) {
  if (!text || !search) return false
  return search.findPrevious(text)
}

function zoom(delta: number) {
  if (!term) return
  const next = Math.min(32, Math.max(8, (term.options.fontSize ?? 14) + delta))
  term.options.fontSize = next
  doFit()
}

function scrollLineUp() {
  term?.scrollLines(-1)
}

function scrollLineDown() {
  term?.scrollLines(1)
}

defineExpose({
  clear,
  focus,
  fit: fitNow,
  getSelection,
  write,
  findNext,
  findPrevious,
  zoom,
  scrollLineUp,
  scrollLineDown,
  getTerm: () => term,
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
  background: #FBFCFE;
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
}

.xterm-host :deep(.xterm) {
  height: 100%;
}
</style>
