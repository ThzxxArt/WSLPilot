<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import TitleBar from './TitleBar.vue'
import SidebarNav from './SidebarNav.vue'
import StatusBar from './StatusBar.vue'
import { errorLine } from '../composables/useAppError'
import { useSettingsStore } from '../stores/settings'

const sidebarCollapsed = ref(false)

/**
 * 侧栏折叠状态持久化到 `ui-state.jsonc`（review 幽灵字段根治）：
 * 此前是纯内存 ref，用户折叠侧栏后重启即弹回。
 */
onMounted(async () => {
  try {
    const ui = await window.wslAPI.config.get('uiState')
    sidebarCollapsed.value = !!ui.sidebarCollapsed
  } catch {
    /* 读不到就用默认展开，不阻断布局 */
  }
})

watch(sidebarCollapsed, (v) => {
  void window.wslAPI.config.set('uiState', { sidebarCollapsed: v }).catch(() => {
    /* 持久化失败不影响本次会话内的折叠状态 */
  })
})

/**
 * 全局快捷键（§11.5）：⌘K 面板 / ⌘N 新终端 / ⌘, 设置 / ⌘R 刷新 / ⌘⇧P 命令可见 / ⌘1..9 切标签。
 * 挂在布局层（message provider 内）：失败路径可即时 toast，杜绝静默。
 */
const message = useMessage()
const settings = useSettingsStore()

/**
 * 设置落盘失败的统一提示（review M-3）：
 * 21 个 setter 走乐观更新，失败已回滚 UI 值并记录 lastError；
 * 这里监听 persistErrorAt 给出一次性 Toast，杜绝「开关显示已改、磁盘没改」的静默失效。
 */
watch(
  () => settings.persistErrorAt,
  (at, prev) => {
    if (!at || at === prev) return
    message.error(errorLine(settings.lastError, '设置保存失败，已还原该选项'))
  },
)

/**
 * 设置加载失败的统一提示（review 状态诚实）：
 * load() 失败降级默认值并记录 loadErrorAt；这里监听它一次性如实提示，
 * 绝不把「读配置失败」伪装成「配置就是默认值」。
 */
watch(
  () => settings.loadErrorAt,
  (at, prev) => {
    if (!at || at === prev) return
    message.error(errorLine(settings.lastError, '设置加载失败，已使用默认值'))
  },
)
</script>

<template>
  <div class="layout">
    <!-- 无障碍：跳到主内容（键盘用户首个 Tab 目标） -->
    <a class="skip-link" href="#main-content">跳到主内容</a>
    <TitleBar />
    <div class="layout-body">
      <SidebarNav v-model:collapsed="sidebarCollapsed" />
      <main id="main-content" class="layout-content" tabindex="-1">
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <!-- 只缓存终端页：切路由不卸载 xterm（0.1.4 回归修复）；其他页保持原有生命周期 -->
            <KeepAlive :include="['TerminalView']">
              <component :is="Component" />
            </KeepAlive>
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

/* 跳转主内容：默认移出视口，聚焦时现身（无障碍通用模式） */
.skip-link {
  position: absolute;
  left: 12px;
  top: -48px;
  z-index: var(--z-toast);
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--color-accent);
  color: var(--color-text-inverse);
  font-size: 13px;
  font-weight: 600;
  transition: top var(--dur-fast) var(--ease-standard);
}

.skip-link:focus {
  top: 8px;
  outline: 2px solid var(--color-accent-hover);
  outline-offset: 2px;
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

/* 主内容容器被脚本聚焦时不要画外框（跳转锚点，非交互控件） */
.layout-content:focus {
  outline: none;
}
</style>
