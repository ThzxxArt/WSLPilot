<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import SidebarNav from './SidebarNav.vue'
import TerminalView from '../views/TerminalView.vue'
import { useWorkbenchStore } from '../stores/workbench'
import { useSettingsStore } from '../stores/settings'

/**
 * 终端工作台壳（0.2.0）：
 * - 不渲染全局 TitleBar / StatusBar，避免 40px + 28px 固定开销
 * - 导航轨默认 56px，专注模式隐藏；settings.workbench.autoCollapseSidebar=false 时展开
 * - TerminalView 直接挂载并跨路由保活：整个 WorkbenchLayout 常驻，
 *   不再依赖 router-view 的 KeepAlive（切换布局会把 KeepAlive 一起卸载，
 *   vim/htop 现场与 xterm 实例会丢失 — 0.2.0 review 根治）。
 */
const route = useRoute()
const workbench = useWorkbenchStore()
const settings = useSettingsStore()

const isWorkbenchRoute = computed(
  () => route.meta?.layout === 'workbench' || route.name === 'terminal',
)
const showRail = computed(() => !workbench.focusMode)
/** 首次进入终端才挂载 TerminalView；之后仅隐藏，不销毁 */
const visited = ref(isWorkbenchRoute.value)
watch(isWorkbenchRoute, (on) => {
  if (on) visited.value = true
  else workbench.exitFocus()
})
const collapsed = computed(() => settings.workbenchAutoCollapseSidebar)

onMounted(async () => {
  try {
    const ui = await window.wslAPI.config.get('uiState')
    const open = (ui as { workbench?: { sessionRailOpen?: unknown } }).workbench?.sessionRailOpen
    if (typeof open === 'boolean') workbench.sessionRailOpen = open
  } catch {
    /* 读不到就用默认收起 */
  }
})

watch(
  () => workbench.sessionRailOpen,
  (open) => {
    void window.wslAPI.config
      .set('uiState', { workbench: { sessionRailOpen: open } })
      .catch(() => {})
  },
)
</script>

<template>
  <div class="workbench" :class="{ focus: workbench.focusMode }">
    <a class="skip-link" href="#terminal-main">跳到终端</a>
    <div class="workbench-body">
      <SidebarNav v-if="showRail" :collapsed="collapsed" :locked="collapsed" />
      <main id="terminal-main" class="workbench-content" tabindex="-1">
        <TerminalView v-if="visited" />
      </main>
    </div>
    <button
      v-if="workbench.focusMode && isWorkbenchRoute"
      class="focus-exit"
      type="button"
      aria-label="退出专注模式"
      @click="workbench.exitFocus()"
    >
      退出专注模式 · Esc
    </button>
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-workbench-bg, var(--color-bg-canvas));
}

.workbench-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.workbench-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workbench-content:focus {
  outline: none;
}

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

.focus-exit {
  position: fixed;
  right: 16px;
  bottom: 12px;
  z-index: 20;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  font-size: 11.5px;
  box-shadow: var(--shadow-xs);
}
</style>
