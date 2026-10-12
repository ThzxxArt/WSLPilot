<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useTasksStore } from '../stores/tasks'
import { useDistrosStore } from '../stores/distros'
import { useMetricsStore } from '../stores/metrics'
import { taskTypeLabel } from '../composables/useTaskProgress'
import TaskDrawer from '../features/tasks/TaskDrawer.vue'

const settings = useSettingsStore()
const tasks = useTasksStore()
const distros = useDistrosStore()
const metrics = useMetricsStore()
const now = ref(new Date())
const drawerOpen = ref(false)
let timer: number | undefined

onMounted(() => {
  timer = window.setInterval(() => (now.value = new Date()), 30_000)
})
onUnmounted(() => window.clearInterval(timer))

const timeLabel = computed(() =>
  now.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
)

const versionLabel = computed(() => settings.version || '—')

/**
 * 服务健康接真实状态（review 0.1.2 根治）：发行版列表或指标采样失败时，
 * 状态点不得恒绿粉饰；显示警示文案并可查看错误根因。
 */
const serviceError = computed(() => distros.lastError ?? metrics.lastError ?? null)
const serviceLabel = computed(() => (serviceError.value ? '服务异常' : '就绪'))

/** 长任务常驻进度（设计书 §13.4）：状态栏显示 → 点击展开任务面板（日志 / 取消） */
const runningTasks = computed(() => tasks.running)
const runningCount = computed(() => runningTasks.value.length)
const runningTask = computed(() => runningTasks.value[runningTasks.value.length - 1] ?? null)
const hasEntries = computed(() => tasks.entries.length > 0)
const taskLabel = computed(() => {
  // 多任务并行时显示任务数（review 0.1.2 根治）：单任务详情不再代表全局
  if (runningCount.value > 1) return `运行任务 ${runningCount.value}`
  const t = runningTask.value
  if (!t) return ''
  const pct = t.percent === null ? '…' : `${Math.round(t.percent)}%`
  return `${taskTypeLabel(t.type)}${t.distro ? ` ${t.distro}` : ''} · ${pct}`
})

/**
 * 无障碍播报只在任务开始/结束（running 数量迁移）时更新，
 * 进度高频变化不再反复打断读屏（review 0.1.2 根治）。
 */
const announcement = ref('')
watch(runningCount, (next, prev) => {
  if (next > prev) {
    announcement.value = next > 1 ? `新任务开始，共 ${next} 个任务运行中` : '任务已开始'
  } else if (next < prev) {
    announcement.value = next > 0 ? `一个任务已结束，仍有 ${next} 个任务运行中` : '全部任务已结束'
  }
})

function openTasks() {
  drawerOpen.value = true
}
</script>

<template>
  <footer class="statusbar">
    <div class="left">
      <span
        class="dot"
        :class="{ warn: !!serviceError }"
        :title="serviceError ? serviceError.message : undefined"
        aria-hidden="true"
      />
      <span class="muted">{{ serviceLabel }}</span>
      <!-- 无障碍：任务开始/结束迁移时播报（进度高频更新不刷屏） -->
      <span class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
      <span class="task-slot">
        <template v-if="runningTask">
          <span class="sep" aria-hidden="true">·</span>
          <button
            class="task-chip"
            :title="runningTask.message"
            :aria-label="`任务进行中：${taskLabel}，点击查看任务详情`"
            @click="openTasks"
          >
            <span class="task-pulse" aria-hidden="true" />
            {{ taskLabel }}
          </button>
        </template>
        <button
          v-else-if="hasEntries"
          class="task-link"
          aria-label="查看任务记录"
          @click="openTasks"
        >
          任务
        </button>
      </span>
      <span class="sep" aria-hidden="true">·</span>
      <span class="muted">WSLPilot v{{ versionLabel }}</span>
    </div>
    <div class="right">
      <span class="muted">{{ timeLabel }}</span>
    </div>
    <TaskDrawer v-model:show="drawerOpen" />
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

/* 服务异常（发行版/指标任一 lastError）：警示色替换恒绿 */
.dot.warn {
  background: var(--color-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 20%, transparent);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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

.task-link {
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 999px;
}

.task-link:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
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
</style>
