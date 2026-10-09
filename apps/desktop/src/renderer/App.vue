<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NConfigProvider, NMessageProvider, NDialogProvider, NSpin, zhCN, dateZhCN } from 'naive-ui'
import DefaultLayout from './layouts/DefaultLayout.vue'
import { useSettingsStore } from './stores/settings'
import { useNaiveTheme, applyAccentToDom } from '@wslpilot/ui'
import type { AccentName } from '@wslpilot/ui'
import type { ConfigKey } from '@wslpilot/shared'

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
let unsubConflict: (() => void) | undefined

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

  // 外部修改冲突：设计书 §6.10-3「重载 / 覆盖」（对比见配置目录）
  unsubConflict = window.wslAPI?.config.onConflict((payload) => {
    const action = window.confirm(
      `配置文件 ${payload.fileKey} 已被外部修改。\n\n${payload.detail}\n\n点「确定」= 重载（以磁盘为准）\n点「取消」= 覆盖（以应用内为准）\n\n需要对比请打开配置目录手工查看。`,
    )
    void window.wslAPI.config
      .resolveConflict(
        payload.fileKey as ConfigKey,
        action ? 'reload' : 'overwrite',
      )
      .then(() => {
        if (payload.fileKey === 'settings') void settings.load()
      })
      .catch(() => {
        // 忽略：下次写入前会再次检测
      })
  })
})

onUnmounted(() => {
  unsubConfig?.()
  unsubNavigate?.()
  unsubConflict?.()
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
        <div
          v-if="ready"
          class="pilot-shell"
        >
          <DefaultLayout />
        </div>
        <div
          v-else
          class="loading-screen"
        >
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
