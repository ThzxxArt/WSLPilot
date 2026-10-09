import { defineStore } from 'pinia'
import type {
  IoExportRequest,
  IoImportRequest,
  IoMoveRequest,
  TaskHandle,
  TaskProgress,
  TaskStatus,
  TaskType,
} from '@wslpilot/shared'
import { toAppError, type AppError } from '@shared/errors'

export interface TaskEntry {
  taskId: string
  type: TaskType
  distro?: string
  percent: number | null
  message: string
  status: TaskStatus
  logs: string[]
  startedAt: number
  finishedAt?: number
  /** 失败 / 取消原因（面向用户） */
  error?: string
}

/** 单任务日志上限（渲染侧防内存膨胀） */
export const MAX_TASK_LOGS = 2000

function emptyEntry(
  taskId: string,
  type: TaskType,
  distro: string | undefined,
  message: string,
): TaskEntry {
  return {
    taskId,
    type,
    distro,
    percent: null,
    message,
    status: 'running',
    logs: [],
    startedAt: Date.now(),
  }
}

/**
 * 长任务（导出 / 导入 / 迁移）状态仓。
 * 进度由主进程 `task:progress` 事件驱动（App.vue 应用级常驻订阅）。
 */
export const useTasksStore = defineStore('tasks', {
  state: () => ({
    entries: [] as TaskEntry[],
    lastError: null as AppError | null,
  }),

  getters: {
    byId: (s) => (taskId: string) => s.entries.find((t) => t.taskId === taskId) ?? null,
    running: (s) => s.entries.filter((t) => t.status === 'running'),
    runningCount: (s) => s.entries.filter((t) => t.status === 'running').length,
    latest: (s) => s.entries[s.entries.length - 1] ?? null,
  },

  actions: {
    /** 主进程 task:progress → 本地状态 */
    applyProgress(p: TaskProgress) {
      if (!p || !p.taskId) return
      let e = this.entries.find((x) => x.taskId === p.taskId)
      if (!e) {
        e = emptyEntry(p.taskId, p.type, p.distro, p.message)
        this.entries.push(e)
      }
      if (typeof p.percent === 'number' && Number.isFinite(p.percent)) e.percent = p.percent
      if (p.message) e.message = p.message
      if (p.distro && !e.distro) e.distro = p.distro
      e.status = p.status
      if (p.logLine !== undefined && p.logLine !== '') {
        e.logs.push(p.logLine)
        if (e.logs.length > MAX_TASK_LOGS) e.logs.splice(0, e.logs.length - MAX_TASK_LOGS)
      }
      if (p.status !== 'running') {
        e.finishedAt = Date.now()
        if (p.status === 'failed') e.error = p.message
        if (p.status === 'canceled') e.error = e.error ?? '任务已取消'
        this.trimFinished()
      }
    },

    /** 保留最近 KEEP_FINISHED 条终态记录，防无界增长（review M7） */
    trimFinished() {
      const KEEP_FINISHED = 10
      const finished = this.entries.filter((t) => t.status !== 'running')
      const overflow = finished.length - KEEP_FINISHED
      if (overflow <= 0) return
      const drop = new Set(
        finished
          .sort((a, b) => a.startedAt - b.startedAt)
          .slice(0, overflow)
          .map((t) => t.taskId),
      )
      this.entries = this.entries.filter((t) => !drop.has(t.taskId))
    },

    /** invoke 返回 handle 后立即占位（事件到达前 UI 有即时反馈） */
    track(
      handle: TaskHandle,
      meta: { type: TaskType; distro?: string; message: string },
    ): TaskEntry {
      const existing = this.entries.find((x) => x.taskId === handle.taskId)
      if (existing) return existing
      const e = emptyEntry(handle.taskId, meta.type, meta.distro, meta.message)
      this.entries.push(e)
      return e
    },

    async startExport(req: IoExportRequest): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.io.export(req)
        return this.track(handle, { type: 'export', distro: req.name, message: `导出 ${req.name}` })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    async startImport(req: IoImportRequest): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.io.import(req)
        return this.track(handle, { type: 'import', distro: req.name, message: `导入 ${req.name}` })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    async startMove(req: IoMoveRequest): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.io.move(req)
        return this.track(handle, { type: 'move', distro: req.name, message: `迁移 ${req.name}` })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    /** 安装发行版（wsl --install） */
    async startInstall(name?: string): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.distros.install(name)
        return this.track(handle, {
          type: 'install',
          distro: name,
          message: name ? `安装 ${name}` : '安装 WSL',
        })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    /** WSL1 ↔ WSL2 版本转换（wsl --set-version，长任务） */
    async startConvert(name: string, version: 1 | 2): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.distros.setVersion(name, version)
        return this.track(handle, {
          type: 'convert',
          distro: name,
          message: `转换 ${name} 到 WSL${version}`,
        })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    async cancel(taskId: string): Promise<void> {
      this.lastError = null
      try {
        await window.wslAPI.task.cancel(taskId)
      } catch (e) {
        this.lastError = toAppError(e)
        throw this.lastError
      }
    },

    /** 清理已结束任务（保留运行中的） */
    clearFinished() {
      this.entries = this.entries.filter((t) => t.status === 'running')
    },
  },
})
