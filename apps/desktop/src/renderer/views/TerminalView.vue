<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NEmpty, useMessage } from 'naive-ui'
import { useRoute } from 'vue-router'
import { useTerminalStore } from '../stores/terminal'
import { useDistrosStore } from '../stores/distros'
import { useSettingsStore } from '../stores/settings'
import TerminalTabs from '../features/terminal/TerminalTabs.vue'
import TerminalToolbar from '../features/terminal/TerminalToolbar.vue'
import XtermPane from '../features/terminal/XtermPane.vue'
import {
  DEFAULT_TERMINAL_PREFS,
  type TerminalFontPrefs,
} from '../features/terminal/theme'

const route = useRoute()
const terminal = useTerminalStore()
const distros = useDistrosStore()
const settings = useSettingsStore()
const message = useMessage()

/** 每个 ptyId 一个 XtermPane 实例（v-show 保活，切标签不丢现场） */
const paneRefs = new Map<string, InstanceType<typeof XtermPane>>()
const cursorPos = ref({ col: 1, row: 1 })
const elapsed = ref('00:00')
let timer: number | undefined

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

const distroOptions = computed(() =>
  distros.items.map((d) => ({
    label: d.meta?.alias || d.name,
    value: d.name,
  })),
)

const defaultDistro = computed(() => {
  const q = route.query.distro
  if (typeof q === 'string' && q) return q
  return distros.defaultDistro?.name ?? distros.items[0]?.name ?? ''
})

function tickElapsed() {
  const s = terminal.active
  if (!s) {
    elapsed.value = '00:00'
    return
  }
  const sec = Math.floor((Date.now() - s.createdAt) / 1000)
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  elapsed.value = `${m}:${ss}`
}

onMounted(async () => {
  await Promise.all([distros.refresh(), terminal.loadLimits()])
  if (terminal.sessions.length === 0 && defaultDistro.value) {
    await create(defaultDistro.value)
  } else if (terminal.activeId === '' && terminal.sessions.length > 0) {
    terminal.setActive(terminal.sessions[0]!.ptyId)
  }
  timer = window.setInterval(tickElapsed, 1000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})

watch(
  () => route.query.distro,
  async (d: unknown) => {
    if (typeof d === 'string' && d) {
      await create(d)
    }
  },
)

watch(
  () => terminal.activeId,
  () => {
    cursorPos.value = { col: 1, row: 1 }
    // 激活标签后重新 fit（v-show 隐藏时尺寸可能为 0）
    requestAnimationFrame(() => activePane()?.fit())
  },
)

async function create(distro: string) {
  const id = await terminal.open(distro)
  if (!id && terminal.lastError) {
    message.error(terminal.lastError.message)
  }
}

async function close(id: string) {
  await terminal.kill(id)
  message.success('终端已关闭')
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
  const sel = activePane()?.getSelection() ?? ''
  if (!sel) {
    message.info('请先在终端中选中内容')
    return
  }
  void navigator.clipboard?.writeText(sel).then(
    () => message.success('已复制'),
    () => message.error('复制失败'),
  )
}

function onExport() {
  const s = terminal.active
  if (!s) return
  const blob = new Blob([s.buffer], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const safe = s.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  a.download = `${safe}-${Date.now()}.log`
  a.click()
  URL.revokeObjectURL(a.href)
  message.success('会话已导出')
}

function onSearch(q: string) {
  const ok = activePane()?.findNext(q)
  if (!ok) message.info('未找到匹配')
}

function onSearchNext() {
  activePane()?.findNext('')
}

function onSearchPrev() {
  activePane()?.findPrevious('')
}

function onZoom(delta: number) {
  activePane()?.zoom(delta)
}

function onCursorMove(pos: { col: number; row: number }) {
  cursorPos.value = pos
}

const offData = window.wslAPI.terminal.onData((p) => {
  terminal.appendOutput(p.ptyId, p.chunk)
})
const offExit = window.wslAPI.terminal.onExit((p) => {
  terminal.handleExit(p.ptyId, p.code)
})
onUnmounted(() => {
  offData()
  offExit()
})
</script>

<template>
  <div class="terminal-view">
    <header class="page-header">
      <div>
        <h1>终端</h1>
        <p class="sub">
          node-pty + xterm.js · 会话 {{ terminal.aliveCount }}/{{ terminal.maxSessions }}
          <template v-if="terminal.active">
            · {{ terminal.active.distro }}
          </template>
        </p>
      </div>
    </header>

    <TerminalTabs
      :sessions="terminal.sessions"
      :active-id="terminal.activeId"
      :max-sessions="terminal.maxSessions"
      :distro-options="distroOptions"
      :default-distro="defaultDistro"
      @create="create"
      @select="terminal.setActive"
      @close="close"
      @rename="onRename"
      @reorder="onReorder"
    />

    <div class="toolbar-row">
      <TerminalToolbar
        :can-zoom="!!terminal.active"
        :font-size="prefs.fontSize"
        @clear="onClear"
        @search="onSearch"
        @search-next="onSearchNext"
        @search-prev="onSearchPrev"
        @copy="onCopy"
        @export="onExport"
        @zoom="onZoom"
      />
    </div>

    <div class="panes">
      <!-- v-show 保活：切标签不 dispose xterm，现场不丢 -->
      <div
        v-for="s in terminal.sessions"
        v-show="s.ptyId === terminal.activeId"
        :key="s.ptyId"
        class="pane-wrap"
      >
        <XtermPane
          :ref="(el) => setPaneRef(s.ptyId, el)"
          :pty-id="s.ptyId"
          :prefs="prefs"
          :initial-buffer="s.buffer"
          class="pane"
          @cursor-move="onCursorMove"
        />
      </div>

      <n-empty
        v-if="terminal.sessions.length === 0"
        description="还没有终端会话"
        class="empty"
      >
        <template #extra>
          <n-button
            type="primary"
            :disabled="!defaultDistro"
            @click="create(defaultDistro)"
          >
            打开 {{ defaultDistro || '终端' }}
          </n-button>
        </template>
      </n-empty>
    </div>

    <footer class="status">
      <span>行 {{ cursorPos.row }} · 列 {{ cursorPos.col }}</span>
      <span>UTF-8</span>
      <span>会话时长 {{ elapsed }}</span>
      <span
        v-if="terminal.active && !terminal.active.alive"
        class="dead"
      >
        已退出（代码 {{ terminal.active.exitCode }}）
      </span>
    </footer>
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

.pane-wrap,
.pane {
  flex: 1;
  min-height: 0;
  height: 100%;
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
