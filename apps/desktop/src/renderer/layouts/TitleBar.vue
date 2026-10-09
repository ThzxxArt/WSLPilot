<script setup lang="ts">
import { computed } from 'vue'
import { NTooltip } from 'naive-ui'
import { useSettingsStore } from '../stores/settings'
import { useCommandPalette } from '../composables/useCommandPalette'
import { ACCENT_GRADIENTS } from '@shared/constants'

const settings = useSettingsStore()
const { openPalette } = useCommandPalette()

const gradient = computed(() => ACCENT_GRADIENTS[settings.accent] ?? ACCENT_GRADIENTS.aurora)

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    openPalette()
  }
}

function minimize() {
  void window.wslAPI.app.minimize()
}

function toggleMaximize() {
  void window.wslAPI.app.maximize()
}

function close() {
  // 主进程按 closeBehavior 决定：最小化到托盘或退出
  void window.wslAPI.app.close()
}
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-brand">
      <div class="logo" :style="{ background: gradient }" />
      <span class="title">WSLPilot</span>
    </div>

    <div class="titlebar-search">
      <button
        class="search-box"
        type="button"
        aria-label="打开命令面板"
        @click="openPalette"
        @keydown="onSearchKeydown"
      >
        <span class="search-placeholder">搜索或执行命令…</span>
        <kbd>Ctrl K</kbd>
      </button>
    </div>

    <div class="titlebar-actions">
      <div class="window-controls no-drag">
        <n-tooltip trigger="hover">
          <template #trigger>
            <button class="win-btn" aria-label="最小化" @click="minimize">
              <svg width="10" height="1" viewBox="0 0 10 1">
                <rect width="10" height="1" fill="currentColor" />
              </svg>
            </button>
          </template>
          最小化
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <button class="win-btn" aria-label="最大化" @click="toggleMaximize">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" />
              </svg>
            </button>
          </template>
          最大化
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <button class="win-btn win-close" aria-label="关闭" @click="close">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.2" />
              </svg>
            </button>
          </template>
          关闭
        </n-tooltip>
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  -webkit-app-region: drag;
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border-bottom: 1px solid var(--color-border-subtle);
  user-select: none;
}

.titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 160px;
}

.logo {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  box-shadow: 0 2px 8px -2px var(--color-accent-soft);
}

.title {
  font-weight: 650;
  font-size: 13px;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
}

.titlebar-search {
  flex: 1;
  display: flex;
  justify-content: center;
  -webkit-app-region: no-drag;
}

.search-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: min(420px, 100%);
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-subtle);
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: border-color var(--dur-fast) var(--ease-standard);
}

.search-box:hover {
  border-color: var(--color-border-strong);
}

.search-placeholder {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
}

.titlebar-actions {
  min-width: 160px;
  display: flex;
  justify-content: flex-end;
  -webkit-app-region: no-drag;
}

.window-controls {
  display: flex;
  gap: 2px;
}

.win-btn {
  width: 36px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--color-text-secondary);
  transition: background var(--dur-instant) var(--ease-standard);
}

.win-btn:hover {
  background: var(--color-bg-hover);
}

.win-close:hover {
  background: var(--color-danger);
  color: #fff;
}
</style>
