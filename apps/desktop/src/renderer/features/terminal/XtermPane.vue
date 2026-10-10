<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { useMessage } from 'naive-ui'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { DEFAULT_TERMINAL_PREFS, resolveTerminalTheme, type TerminalFontPrefs } from './theme'
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
    // 真 PTY 数据：不要 convertEol，避免 TUI 光标异常（评审 M2）
    convertEol: false,
    theme: resolveTerminalTheme(settings.terminalTheme, settings.accent),
    ...DEFAULT_TERMINAL_PREFS,
  })
  applyPrefs(t, props.prefs)
  term = t
  fit = new FitAddon()
  search = new SearchAddon()
  t.loadAddon(fit)
  t.loadAddon(search)
  t.loadAddon(new WebLinksAddon())
  // Unicode 11 宽字符（中文/emoji 表格不错位）评审 M3
  t.loadAddon(new Unicode11Addon())
  t.unicode.activeVersion = '11'
  t.open(host.value)

  // 恢复历史缓冲（切标签 / 重挂时）
  if (props.initialBuffer) {
    t.write(props.initialBuffer)
  }

  doFit()

  t.onData((data) => {
    // 超过 IPC 上限的粘贴必须分片（否则 zod 拒绝后输入静默丢失 — review 根治）
    for (const chunk of chunkTerminalInput(data)) {
      void window.wslAPI.terminal.input(props.ptyId, chunk).catch((e: unknown) => {
        message.error(errorLine(e, '终端输入发送失败'))
      })
    }
  })
  t.onResize(({ cols, rows }) => {
    // 尺寸夹到 IPC schema 上限内：宁可静默夹紧，也不要被拒后 xterm 与 PTY 永久失步
    void window.wslAPI.terminal
      .resize(props.ptyId, Math.min(cols, 500), Math.min(rows, 200))
      .catch((e: unknown) => {
        message.error(errorLine(e, '终端尺寸同步失败'))
      })
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

  const offData = window.wslAPI.terminal.onData((p) => {
    if (p.ptyId !== props.ptyId) return
    t.write(p.chunk)
  })
  const offExit = window.wslAPI.terminal.onExit((p) => {
    if (p.ptyId !== props.ptyId) return
    t.write(`\r\n\x1b[90m[进程已退出，代码 ${p.code}]\x1b[0m\r\n`)
  })
  unsubs.push(offData, offExit)

  ro = new ResizeObserver(() => doFit())
  ro.observe(host.value)

  fitTimer = window.setTimeout(doFit, 50)
})

onBeforeUnmount(() => {
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
      doFit()
    }
  },
  { deep: true },
)

// 终端主题跟随设置（auto / follow-app / custom）
watch(
  () => [settings.terminalTheme, settings.accent] as const,
  () => {
    if (term) term.options.theme = resolveTerminalTheme(settings.terminalTheme, settings.accent)
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
</style>
