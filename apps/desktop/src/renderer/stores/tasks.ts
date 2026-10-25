import { defineStore } from 'pinia'
import {
  toAppError,
  type AppError,
  type DistroInstallOptions,
  type IoCloneRequest,
  type IoExportRequest,
  type IoImportRequest,
  type IoMoveRequest,
  type TaskHandle,
  type TaskProgress,
  type TaskStatus,
  type TaskType,
} from '@wslpilot/shared'

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
      const wasRunning = e.status === 'running'
      e.status = p.status
      if (p.logLine !== undefined && p.logLine !== '') {
        e.logs.push(p.logLine)
        if (e.logs.length > MAX_TASK_LOGS) e.logs.splice(0, e.logs.length - MAX_TASK_LOGS)
      }
      if (p.status !== 'running') {
        // 终态重复事件不刷新 finishedAt（时间只会前移，重复到达不得把结束时间后拨）
        if (wasRunning) e.finishedAt = Date.now()
        if (p.status === 'failed') {
          // 失败原因取主进程端到端携带的 error，绝不用最后一条 message 冒充（review 0.1.2 根治）
          e.error = p.error?.trim() || e.error || '任务执行失败'
        }
        if (p.status === 'canceled') e.error = p.error?.trim() || e.error || '任务已取消'
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

    /** 安装发行版（wsl --install，0.1.4 支持高级选项） */
    async startInstall(opts?: string | DistroInstallOptions): Promise<TaskEntry | null> {
      this.lastError = null
      const normalized: DistroInstallOptions =
        typeof opts === 'string' ? { name: opts } : (opts ?? {})
      const name = normalized.name
      try {
        const handle = await window.wslAPI.distros.install(normalized)
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

    /** 更新 WSL 本体（wsl --update — 0.1.3） */
    async startUpdate(opts?: { preRelease?: boolean }): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.app.wslUpdate(opts)
        return this.track(handle, {
          type: 'update',
          message: opts?.preRelease ? '更新 WSL（预发布通道）' : '更新 WSL',
        })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    /** 稀疏磁盘（wsl --manage --set-sparse — 0.1.3） */
    async startSparse(name: string, sparse: boolean): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.distros.setSparse(name, sparse)
        return this.track(handle, {
          type: 'manage',
          distro: name,
          message: sparse ? `启用 ${name} 的稀疏磁盘` : `关闭 ${name} 的稀疏磁盘`,
        })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    /** 压缩虚拟磁盘（0.1.4；会终止运行中发行版，terminateFirst 已由 UI 确认） */
    async startCompact(name: string, terminateFirst: boolean): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.distros.compact(name, terminateFirst)
        return this.track(handle, {
          type: 'manage',
          distro: name,
          message: `压缩 ${name} 的虚拟磁盘`,
        })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    /** 扩容虚拟磁盘（0.1.4；只增不减） */
    async startResize(name: string, size: string): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.distros.resize(name, size)
        return this.track(handle, {
          type: 'manage',
          distro: name,
          message: `扩容 ${name} 到 ${size}`,
        })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    /** 设置默认用户（0.1.4；新会话生效） */
    async startSetDefaultUser(name: string, user: string): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.distros.setDefaultUser(name, user)
        return this.track(handle, {
          type: 'manage',
          distro: name,
          message: `设置 ${name} 的默认用户为 ${user}`,
        })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    /** 克隆发行版（0.1.3）：导出临时归档 → 导入新名 → 自动清理 */
    async startClone(req: IoCloneRequest): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.io.clone(req)
        return this.track(handle, {
          type: 'clone',
          distro: req.name,
          message: `克隆 ${req.name} → ${req.newName}`,
        })
      } catch (e) {
        this.lastError = toAppError(e)
        return null
      }
    },

    /** 注销发行版（0.1.3 任务化；可选注销前自动备份） */
    async startUnregister(
      name: string,
      opts?: { backupFirst?: boolean },
    ): Promise<TaskEntry | null> {
      this.lastError = null
      try {
        const handle = await window.wslAPI.distros.unregister(name, opts)
        return this.track(handle, { type: 'unregister', distro: name, message: `注销 ${name}` })
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
