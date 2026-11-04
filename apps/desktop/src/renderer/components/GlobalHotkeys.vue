<script setup lang="ts">
/**
 * 全局快捷键（0.2.0）— 从 DefaultLayout 上移到应用壳：
 * 终端路由使用独立 WorkbenchLayout，若继续绑定在 DefaultLayout，
 * 进入终端后 Ctrl+N / Ctrl+Tab / 分屏快捷键会全部失效。
 */
import { onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { bindGlobalHotkeys } from '../composables/useHotkeys'
import { useCommandPalette } from '../composables/useCommandPalette'
import { errorLine } from '../composables/useAppError'
import { useDistrosStore } from '../stores/distros'
import { useSettingsStore } from '../stores/settings'
import { useTerminalStore } from '../stores/terminal'

const router = useRouter()
const route = useRoute()
const message = useMessage()
const { togglePalette } = useCommandPalette()
const distros = useDistrosStore()
const settings = useSettingsStore()
const terminal = useTerminalStore()

async function openNewTerminal() {
  if (!terminal.canCreate) {
    message.warning(`终端会话数已达上限 ${terminal.maxSessions}，请先关闭部分终端面板`)
    return
  }
  const name = distros.defaultDistro?.name ?? distros.visibleItems[0]?.name
  if (!name) {
    message.warning('没有可用的发行版')
    return
  }
  const id = await terminal.openDefault(name)
  if (!id) {
    message.error(errorLine(terminal.lastError, '新建终端失败'))
    return
  }
  await router.push('/terminal')
}

function cycleTerminalTab(delta: number) {
  const tabs = terminal.tabs
  if (tabs.length === 0) return
  const idx = tabs.findIndex((t) => t.id === terminal.activeTabId)
  const next = (idx + delta + tabs.length) % tabs.length
  terminal.setActiveTab(tabs[next]!.id)
  void router.push('/terminal')
}

async function splitActiveTerminal(dir: 'row' | 'col') {
  if (!terminal.activeId) {
    message.warning('没有活动的终端面板')
    return
  }
  const id = await terminal.splitActive(dir)
  if (!id) {
    message.error(errorLine(terminal.lastError, '分屏失败'))
    return
  }
  await router.push('/terminal')
}

const unbind = bindGlobalHotkeys({
  openPalette: togglePalette,
  newTerminal: () => void openNewTerminal(),
  newTerminalTab: () => void openNewTerminal(),
  nextTerminalTab: () => cycleTerminalTab(1),
  prevTerminalTab: () => cycleTerminalTab(-1),
  splitTerminalRow: () => void splitActiveTerminal('row'),
  splitTerminalCol: () => void splitActiveTerminal('col'),
  openSettings: () => void router.push('/settings'),
  refresh: () => {
    // Ctrl+R 按路由分发：终端页没有「刷新发行版」语义
    if (route.name === 'terminal') return
    void distros.refresh()
  },
  toggleRawCommand: () => {
    // 终端页该组合用于工作台工具栏（TerminalView 内处理），避免一次按键触发两个动作
    if (route.name === 'terminal') return
    void settings.setShowRawCommand(!settings.showRawCommand)
  },
  switchTab: (index) => {
    const tab = terminal.tabs[index]
    if (tab) {
      terminal.setActiveTab(tab.id)
      void router.push('/terminal')
    }
  },
})

onUnmounted(unbind)
</script>

<template>
  <!-- 纯行为组件：无 DOM -->
  <span hidden aria-hidden="true" />
</template>
