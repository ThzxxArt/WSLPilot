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
  /** 挂载时回放的历史输出（切换标签后恢复屏幕） */
  initialBuffer: {
    type: String,
    default: '',
  },
})

const emit = defineEmits<{
  ready: [term: Terminal]
  exit: [code: number]
  cursorMove: [pos: { col: number; row: number }]
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

  // 恢复历史缓冲（切标签 / 重挂时）
  if (props.initialBuffer) {
    t.write(props.initialBuffer)
  }

  doFit()

  t.onData((data) => {
    void window.wslAPI.terminal.input(props.ptyId, data)
  })
  t.onResize(({ cols, rows }) => {
    void window.wslAPI.terminal.resize(props.ptyId, cols, rows)
  })
  t.onCursorMove(() => {
    emit('cursorMove', {
      col: t.buffer.active.cursorX + 1,
      row: t.buffer.active.cursorY + 1,
    })
  })

  const offData = window.wslAPI.terminal.onData((p) => {
    if (p.ptyId !== props.ptyId) return
    t.write(p.chunk)
  })
  const offExit = window.wslAPI.terminal.onExit((p) => {
    if (p.ptyId !== props.ptyId) return
    t.write(`\r\n\x1b[90m[进程已退出，代码 ${p.code}]\x1b[0m\r\n`)
    emit('exit', p.code)
  })
  unsubs.push(offData, offExit)

  ro = new ResizeObserver(() => doFit())
  ro.observe(host.value)

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
  <div
    ref="host"
    class="xterm-host"
  />
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
