<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import TitleBar from './TitleBar.vue'
import SidebarNav from './SidebarNav.vue'
import StatusBar from './StatusBar.vue'
import { bindGlobalHotkeys } from '../composables/useHotkeys'
import { useCommandPalette } from '../composables/useCommandPalette'
import { errorLine } from '../composables/useAppError'
import { useDistrosStore } from '../stores/distros'
import { useSettingsStore } from '../stores/settings'
import { useTerminalStore } from '../stores/terminal'

const sidebarCollapsed = ref(false)

/**
 * 全局快捷键（§11.5）：⌘K 面板 / ⌘N 新终端 / ⌘, 设置 / ⌘R 刷新 / ⌘⇧P 命令可见 / ⌘1..9 切标签。
 * 挂在布局层（message provider 内）：失败路径可即时 toast，杜绝静默。
 */
const router = useRouter()
const message = useMessage()
const { togglePalette } = useCommandPalette()
const distros = useDistrosStore()
const settings = useSettingsStore()
const terminal = useTerminalStore()

const unbindHotkeys = bindGlobalHotkeys({
  openPalette: togglePalette,
  newTerminal: async () => {
    const name = distros.defaultDistro?.name ?? distros.items[0]?.name
    if (!name) {
      message.warning('没有可用的发行版')
      return
    }
    const id = await terminal.open(name)
    if (!id) {
      message.error(errorLine(terminal.lastError, '新建终端失败'))
      return
    }
    await router.push('/terminal')
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
onUnmounted(unbindHotkeys)
</script>

<template>
  <div class="layout">
    <TitleBar />
    <div class="layout-body">
      <SidebarNav v-model:collapsed="sidebarCollapsed" />
      <main class="layout-content">
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
    <StatusBar />
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.layout-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.layout-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--color-bg-canvas);
}
</style>
