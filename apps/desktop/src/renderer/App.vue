<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NConfigProvider, NMessageProvider, NDialogProvider, NSpin, zhCN, dateZhCN } from 'naive-ui'
import DefaultLayout from './layouts/DefaultLayout.vue'
import { useSettingsStore } from './stores/settings'
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

onMounted(async () => {
  await settings.load()
  applyAccentToDom(settings.accent as AccentName)
  ready.value = true

  unsubConfig = window.wslAPI?.config.onChanged(({ fileKey }) => {
    if (fileKey === 'settings') void settings.load()
  })

  // 托盘菜单导航
  unsubNavigate = window.wslAPI?.app.onNavigate((path) => {
    void router.push(path)
  })
})

onUnmounted(() => {
  unsubConfig?.()
  unsubNavigate?.()
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
        <div v-if="ready" class="pilot-shell">
          <DefaultLayout />
        </div>
        <div v-else class="pilot-shell items-center" style="justify-content: center">
          <n-spin size="large" />
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.h-full {
  height: 100%;
}
</style>
