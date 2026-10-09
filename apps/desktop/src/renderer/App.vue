<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NConfigProvider, NMessageProvider, NDialogProvider, NSpin, zhCN, dateZhCN } from 'naive-ui'
import DefaultLayout from './layouts/DefaultLayout.vue'
import ConflictResolver from './features/config/ConflictResolver.vue'
import CommandPalette from './features/command/CommandPalette.vue'
import { useSettingsStore } from './stores/settings'
import { useTerminalStore } from './stores/terminal'
import { attachTaskProgress } from './composables/useTaskProgress'
import { bindCommandPaletteHotkey } from './composables/useCommandPalette'
import { useNaiveTheme, applyAccentToDom } from '@wslpilot/ui'
import type { AccentName } from '@wslpilot/ui'

const settings = useSettingsStore()
const router = useRouter()
const accent = computed(() => settings.accent as AccentName)
const { themeOverrides } = useNaiveTheme(accent)

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
  unsubPtyData = window.wslAPI?.terminal.onData((p) => {
    terminal.appendOutput(p.ptyId, p.chunk)
  })
  unsubPtyExit = window.wslAPI?.terminal.onExit((p) => {
    terminal.handleExit(p.ptyId, p.code)
  })

  // ★ 长任务进度应用级常驻：离开备份页也不丢进度（M4）
  unsubTaskProgress = attachTaskProgress()

  // ★ Ctrl/⌘+K 全局命令面板（§13.3）
  unsubHotkey = bindCommandPaletteHotkey()

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
    :locale="zhCN"
    :date-locale="dateZhCN"
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
