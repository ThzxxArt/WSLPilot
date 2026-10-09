<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settings'

const settings = useSettingsStore()
const now = ref(new Date())
let timer: number | undefined

onMounted(() => {
  timer = window.setInterval(() => (now.value = new Date()), 30_000)
})
onUnmounted(() => window.clearInterval(timer))

const timeLabel = computed(() =>
  now.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
)

const versionLabel = computed(() => settings.version || '—')
</script>

<template>
  <footer class="statusbar">
    <div class="left">
      <span class="dot" />
      <span class="muted">就绪</span>
      <span class="sep">·</span>
      <span class="muted">WSLPilot v{{ versionLabel }}</span>
    </div>
    <div class="right">
      <span class="muted">{{ timeLabel }}</span>
    </div>
  </footer>
</template>

<style scoped>
.statusbar {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  background: var(--color-bg-surface);
  border-top: 1px solid var(--color-border-subtle);
  font-size: 12px;
  user-select: none;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 20%, transparent);
}

.muted {
  color: var(--color-text-tertiary);
}

.sep {
  color: var(--color-border-strong);
}
</style>
