<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NSpin,
  zhCN,
  enUS,
  dateZhCN,
  dateEnUS,
} from 'naive-ui'
import DefaultLayout from './layouts/DefaultLayout.vue'
import ConflictResolver from './features/config/ConflictResolver.vue'
import CommandPalette from './features/command/CommandPalette.vue'
import { useSettingsStore } from './stores/settings'
import { useTerminalStore } from './stores/terminal'
import { attachTaskProgress } from './composables/useTaskProgress'
import { bindGlobalHotkeys } from './composables/useHotkeys'
import { useCommandPalette } from './composables/useCommandPalette'
import { useDistrosStore } from './stores/distros'
import { useNaiveTheme, applyAccentToDom } from '@wslpilot/ui'
import type { AccentName } from '@wslpilot/ui'

const settings = useSettingsStore()
const router = useRouter()
const accent = computed(() => settings.accent as AccentName)
const { themeOverrides } = useNaiveTheme(accent)

/** 语言（settings.general.locale）：system 按浏览器语言判定 */
const naiveLocale = computed(() => {
  if (settings.locale === 'en-US') return enUS
  if (settings.locale === 'zh-CN') return zhCN
  return navigator.language.toLowerCase().startsWith('zh') ? zhCN : enUS
})
const naiveDateLocale = computed(() => (naiveLocale.value === enUS ? dateEnUS : dateZhCN))

const ready = ref(false)

watch(
  () => settings.accent,
  (a) => applyAccentToDom(a as AccentName),
  { immediate: true },
)

watch(
  () => settings.reduceMotion,
  (on) => {
    document.documentElement.dataset.reduceMotion = on ? 'true' : 'false'
  },
  { immediate: true },
)

let unsubConfig: (() => void) | undefined
let unsubNavigate: (() => void) | undefined
let unsubPtyData: (() => void) | undefined
let unsubPtyExit: (() => void) | undefined
let unsubTaskProgress: (() => void) | undefined
let unsubHotkey: (() => void) | undefined

onMounted(async () => {
  // load 内部已降级兜底；此处 finally 保证界面一定走出 loading（review C11）
  try {
    await settings.load()
    applyAccentToDom(settings.accent as AccentName)
  } finally {
    ready.value = true
  }

  unsubConfig = window.wslAPI?.config.onChanged(({ fileKey }) => {
    if (fileKey === 'settings') void settings.load()
  })

  // 托盘菜单导航
  unsubNavigate = window.wslAPI?.app.onNavigate((path) => {
    void router.push(path)
  })

  // ★ PTY 数据应用级常驻：离开终端页也不丢输出（评审 I1）
  const terminal = useTerminalStore()
  // 窗口重载后找回主进程中仍存活的会话（含动作临时 PTY）
  void terminal.recover()
  unsubPtyData = window.wslAPI?.terminal.onData((p) => {
    terminal.appendOutput(p.ptyId, p.chunk)
  })
  unsubPtyExit = window.wslAPI?.terminal.onExit((p) => {
    terminal.handleExit(p.ptyId, p.code)
  })

  // ★ 长任务进度应用级常驻：离开备份页也不丢进度（M4）
  unsubTaskProgress = attachTaskProgress()

  // ★ 全局快捷键（§11.5）：⌘K 命令面板 / ⌘N 新终端 / ⌘, 设置 / ⌘R 刷新 / ⌘⇧P 命令可见 / ⌘1..9 切标签
  const { togglePalette } = useCommandPalette()
  const distros = useDistrosStore()
  unsubHotkey = bindGlobalHotkeys({
    openPalette: togglePalette,
    newTerminal: () => {
      const name = distros.defaultDistro?.name ?? distros.items[0]?.name
      if (name) void terminal.open(name)
      void router.push('/terminal')
    },
    openSettings: () => void router.push('/settings'),
    refresh: () => void distros.refresh(),
    toggleRawCommand: () => void settings.setShowRawCommand(!settings.showRawCommand),
    switchTab: (index) => {
      const session = terminal.sessions[index]
      if (session) {
        terminal.setActive(session.ptyId)
        void router.push('/terminal')
      }
    },
  })

  // 外部配置冲突由 ConflictResolver（NDialog）处理，语义见该组件（review C3）
})

onUnmounted(() => {
  unsubConfig?.()
  unsubNavigate?.()
  unsubPtyData?.()
  unsubPtyExit?.()
  unsubTaskProgress?.()
  unsubHotkey?.()
})
</script>

<template>
  <n-config-provider
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    class="h-full"
  >
    <n-message-provider>
      <n-dialog-provider>
        <ConflictResolver />
        <CommandPalette />
        <div v-if="ready" class="pilot-shell">
          <DefaultLayout />
        </div>
        <div v-else class="loading-screen">
          <n-spin size="large" />
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.pilot-shell {
  height: 100%;
}

.loading-screen {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-canvas);
}
</style>
