<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { NButton, NDrawer, NTag, useMessage } from 'naive-ui'
import { EmptyState } from '@wslpilot/ui'
import { useTasksStore, type TaskEntry } from '../../stores/tasks'
import { formatElapsed, taskStatusLabel, taskTypeLabel } from '../../composables/useTaskProgress'
import { errorLine } from '../../composables/useAppError'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()

const tasks = useTasksStore()
const message = useMessage()
const selectedId = ref('')
/** 取消在途：按钮 pending 防重（review 0.1.2 根治） */
const canceling = ref(false)
/** 耗时显示每秒刷新（Date.now() 非响应式，需 tick 驱动） */
const now = ref(Date.now())
let timer: number | undefined

// 单一 watch(show)：计时器启停 + 首次打开补默认选中（此前拆成两个 watch 重复触发）
watch(
  () => props.show,
  (open) => {
    if (open) {
      if (timer === undefined) timer = window.setInterval(() => (now.value = Date.now()), 1000)
      if (!selectedId.value) selectedId.value = ordered.value[0]?.taskId ?? ''
    } else if (timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  },
)
onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer)
})

/** 最新在前 */
const ordered = computed(() => [...tasks.entries].sort((a, b) => b.startedAt - a.startedAt))
const selected = computed<TaskEntry | null>(() => {
  if (selectedId.value) return tasks.byId(selectedId.value)
  return ordered.value[0] ?? null
})

/**
 * selectedId 可能指向被 trimFinished 淘汰的任务（详情区会整个消失）：
 * 选中项失效时自动回退到最新一条，绝不留下「有列表没详情」的半成品态。
 */
watch(selected, (s) => {
  if (!s && selectedId.value) selectedId.value = ordered.value[0]?.taskId ?? ''
})

function statusType(status: string): 'default' | 'info' | 'success' | 'warning' | 'error' {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'canceled') return 'warning'
  return 'info'
}

async function cancelSelected() {
  const t = selected.value
  if (!t || canceling.value) return
  canceling.value = true
  try {
    await tasks.cancel(t.taskId)
    message.success('已请求取消任务')
  } catch (e) {
    message.error(errorLine(e, '取消任务失败'))
  } finally {
    canceling.value = false
  }
}

function clearFinished() {
  tasks.clearFinished()
  selectedId.value = ordered.value[0]?.taskId ?? ''
  message.success('已清理完成的任务')
}
</script>

<template>
  <n-drawer
    :show="show"
    :width="420"
    placement="right"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="task-drawer">
      <header class="head">
        <h3>任务</h3>
        <div class="head-actions">
          <n-button
            size="tiny"
            quaternary
            :disabled="!tasks.entries.some((t) => t.status !== 'running')"
            @click="clearFinished"
          >
            清理已完成
          </n-button>
        </div>
      </header>

      <div v-if="ordered.length === 0" class="empty">
        <EmptyState description="暂无任务" illustration="📋" size="small" />
      </div>

      <template v-else>
        <ul class="list" role="listbox" aria-label="任务列表">
          <li
            v-for="t in ordered"
            :key="t.taskId"
            class="item"
            :class="{ active: selected?.taskId === t.taskId }"
            role="option"
            tabindex="0"
            :aria-selected="selected?.taskId === t.taskId"
            @click="selectedId = t.taskId"
            @keydown.enter.prevent="selectedId = t.taskId"
            @keydown.space.prevent="selectedId = t.taskId"
          >
            <div class="item-line">
              <span class="item-title"
                >{{ taskTypeLabel(t.type) }}{{ t.distro ? ` · ${t.distro}` : '' }}</span
              >
              <n-tag size="tiny" :bordered="false" :type="statusType(t.status)">
                {{ taskStatusLabel(t.status) }}
              </n-tag>
            </div>
            <div class="item-sub">
              {{ t.message }}
              <span v-if="t.status === 'running'">
                · {{ t.percent === null ? '进行中' : `${Math.round(t.percent)}%` }}
              </span>
            </div>
          </li>
        </ul>

        <section v-if="selected" class="detail">
          <div class="detail-head">
            <span class="detail-title">
              {{ taskTypeLabel(selected.type) }}{{ selected.distro ? ` · ${selected.distro}` : '' }}
            </span>
            <div class="detail-actions">
              <span v-if="selected.status === 'running'" class="elapsed">
                {{ formatElapsed(now - selected.startedAt) }}
              </span>
              <n-button
                v-if="selected.status === 'running'"
                size="tiny"
                type="error"
                secondary
                :loading="canceling"
                :disabled="canceling"
                @click="cancelSelected"
              >
                取消
              </n-button>
            </div>
          </div>
          <p v-if="selected.error" class="error">{{ selected.error }}</p>
          <!-- 单 <pre> 拼接：2000 行日志不再产生 2000 个 DOM 节点（review 0.1.2 根治） -->
          <pre class="log" role="log" aria-live="polite" aria-label="任务日志">{{
            selected.logs.join('\n') || '暂无日志输出'
          }}</pre>
        </section>
      </template>
    </div>
  </n-drawer>
</template>

<style scoped>
.task-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  gap: 12px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

.empty {
  padding: 32px 0;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.item {
  padding: 8px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard);
}

.item:hover {
  border-color: var(--color-border-strong);
}

.item.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.item-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.item-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.item-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.detail-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.elapsed {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.error {
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 11.5px;
}

.log {
  flex: 1;
  min-height: 120px;
  margin: 0;
  overflow-y: auto;
  padding: 8px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: var(--color-bg-sunken);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
