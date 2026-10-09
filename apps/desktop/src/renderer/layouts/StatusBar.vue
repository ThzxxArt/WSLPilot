<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useTasksStore } from '../stores/tasks'
import { taskTypeLabel } from '../composables/useTaskProgress'

const settings = useSettingsStore()
const tasks = useTasksStore()
const router = useRouter()
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

/** 长任务常驻进度（设计书 §13.4）：状态栏显示 → 点击展开任务面板 */
const runningTask = computed(() => tasks.running[tasks.running.length - 1] ?? null)
const taskLabel = computed(() => {
  const t = runningTask.value
  if (!t) return ''
  const pct = t.percent === null ? '…' : `${Math.round(t.percent)}%`
  return `${taskTypeLabel(t.type)}${t.distro ? ` ${t.distro}` : ''} · ${pct}`
})

function openTasks() {
  void router.push('/backup')
}
</script>

<template>
  <footer class="statusbar">
    <div class="left">
      <span class="dot" />
      <span class="muted">就绪</span>
      <template v-if="runningTask">
        <span class="sep">·</span>
        <button
          class="task-chip"
          :title="runningTask.message"
          @click="openTasks"
        >
          <span class="task-pulse" />
          {{ taskLabel }}
        </button>
      </template>
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

.task-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  transition: background var(--dur-fast) var(--ease-standard);
}

.task-chip:hover {
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
}

.task-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: task-pulse 1.4s var(--ease-standard) infinite;
}

@keyframes task-pulse {
  0% {
    transform: scale(1);
    opacity: 1;
  }

  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-pulse {
    animation: none;
  }
}

:root[data-reduce-motion='true'] .task-pulse {
  animation: none;
}
</style>
