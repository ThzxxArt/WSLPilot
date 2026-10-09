import { computed, type ComputedRef, type Ref } from 'vue'
import { useTasksStore, type TaskEntry } from '../stores/tasks'
import type { TaskProgress } from '@wslpilot/shared'

/**
 * 应用级 task:progress 订阅（设计书 §8.2 事件桥）。
 * 在 App.vue 挂载时调用一次：任务在任何页面运行，进度都持续更新。
 * 返回解绑函数。
 */
export function attachTaskProgress(onEvent?: (p: TaskProgress) => void): () => void {
  const store = useTasksStore()
  const off = window.wslAPI?.task.onProgress((p) => {
    store.applyProgress(p)
    onEvent?.(p)
  })
  return off ?? (() => {})
}

export interface TaskProgressView {
  task: ComputedRef<TaskEntry | null>
  /** 0-100；无法估算为 null */
  percent: ComputedRef<number | null>
  /** 展示用："42%" / "进行中…" */
  percentLabel: ComputedRef<string>
  isRunning: ComputedRef<boolean>
  isDone: ComputedRef<boolean>
  cancel: () => Promise<void>
}

/**
 * 单任务进度视图（备份迁移向导第 4 步使用）。
 * taskId 可为字符串或响应式引用。
 */
export function useTaskProgress(taskId: Ref<string> | string): TaskProgressView {
  const store = useTasksStore()
  const idOf = () => (typeof taskId === 'string' ? taskId : taskId.value)

  const task = computed<TaskEntry | null>(() => {
    const id = idOf()
    return id ? store.byId(id) : null
  })

  const percent = computed(() => {
    const v = task.value?.percent ?? null
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  })

  const percentLabel = computed(() => {
    const p = percent.value
    if (p === null) return '进行中…'
    return `${Math.round(p)}%`
  })

  const isRunning = computed(() => task.value?.status === 'running')
  const isDone = computed(() => {
    const t = task.value
    return !!t && t.status !== 'running'
  })

  async function cancel(): Promise<void> {
    const id = idOf()
    if (id) await store.cancel(id)
  }

  return { task, percent, percentLabel, isRunning, isDone, cancel }
}

/** 任务耗时展示 mm:ss */
export function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

/** 任务类型中文名 */
export function taskTypeLabel(type: string): string {
  switch (type) {
    case 'export':
      return '导出备份'
    case 'import':
      return '导入恢复'
    case 'move':
      return '迁移磁盘'
    case 'install':
      return '安装'
    case 'convert':
      return '版本转换'
    case 'action':
      return '自定义动作'
    default:
      return type
  }
}

/** 任务状态中文名 */
export function taskStatusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '进行中'
    case 'success':
      return '已完成'
    case 'failed':
      return '失败'
    case 'canceled':
      return '已取消'
    default:
      return status
  }
}
