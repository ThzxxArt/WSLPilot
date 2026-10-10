import { randomUUID } from 'node:crypto'
import {
  createAppError,
  type TaskHandle,
  type TaskProgress,
  type TaskStatus,
  type TaskType,
} from '@wslpilot/shared'
import type { Logger } from '@wslpilot/kit'

/** 任务内控制面 — 由 IoService 等执行体使用 */
export interface TaskControl {
  readonly taskId: string
  readonly type: TaskType
  readonly distro?: string
  /** 上报进度；percent 无法估算时传 null */
  report(percent: number | null, message?: string): void
  /** 追加一行日志（推送 task:progress 事件 + 记录） */
  log(line: string): void
  isCanceled(): boolean
  throwIfCanceled(): void
  /** 注册取消时的清理动作（kill 子进程等）；任务结束前多次注册均可 */
  onCancel(fn: () => void): void
}

export interface StartTaskOptions {
  type: TaskType
  distro?: string
  /** 初始消息 */
  message: string
  /**
   * 串行锁键：同一键的任务严格串行（设计书 §9.5「同一 distro 的写类任务串行化」）。
   * 省略或 null 表示不加锁、立即并发。
   */
  lockKey?: string | null
  run: (ctl: TaskControl) => Promise<void>
}

export interface TaskRecord {
  taskId: string
  type: TaskType
  distro?: string
  status: TaskStatus
  percent: number | null
  message: string
  logs: string[]
  startedAt: number
  finishedAt?: number
  /** 失败 / 取消原因（面向用户） */
  error?: string
}

export interface TaskRunnerEvents {
  /** 每次 report / log 推送一次（M→R task:progress） */
  onProgress: (p: TaskProgress) => void
  /** 任务进入终态（success / failed / canceled）后调用一次 */
  onFinish?: (rec: TaskRecord) => void
  logger: Logger
}

export interface TaskRunner {
  start(opts: StartTaskOptions): TaskHandle
  /** 请求取消；返回是否命中仍在执行/排队的任务 */
  cancel(taskId: string): boolean
  get(taskId: string): TaskRecord | null
  list(): TaskRecord[]
  /** 等待任务进入终态（测试与编排用） */
  waitFor(taskId: string): Promise<TaskRecord>
  /** 取消全部任务并清空锁（退出时调用） */
  dispose(): void
}

/** 日志上限：超出后丢弃最早的日志行（防长任务撑爆内存） */
const MAX_LOG_LINES = 2000
/** 终态任务记录保留上限（超出后淘汰最旧 — review M4） */
const MAX_FINISHED_RECORDS = 50

function clampPercent(p: number | null): number | null {
  if (p === null || !Number.isFinite(p)) return null
  return Math.max(0, Math.min(100, Math.round(p)))
}

/**
 * TaskRunner（设计书 §9.5）：
 * - spawn 流式处理由执行体完成，Runner 负责任务生命周期、进度事件与取消
 * - 无法估算时 percent = null
 * - 同一 lockKey 的任务串行
 * - 终态写入 state.jsonc.lastTaskResult（onFinish 注入）
 */
export function createTaskRunner(events: TaskRunnerEvents): TaskRunner {
  const tasks = new Map<string, TaskRecord>()
  const cancelRequested = new Set<string>()
  /** 已进入 execute 的任务（区分「排队中」与「执行中」— review M-2） */
  const started = new Set<string>()
  const cancelFns = new Map<string, Set<() => void>>()
  const waiters = new Map<string, Set<(rec: TaskRecord) => void>>()
  /** lockKey → 队尾 promise */
  const locks = new Map<string, Promise<void>>()
  let disposed = false

  function emitProgress(rec: TaskRecord, logLine?: string): void {
    const p: TaskProgress = {
      taskId: rec.taskId,
      type: rec.type,
      distro: rec.distro,
      percent: rec.percent,
      message: rec.message,
      status: rec.status,
    }
    if (logLine !== undefined) p.logLine = logLine
    try {
      events.onProgress(p)
    } catch (e) {
      events.logger.warn('task progress listener failed', { error: String(e) })
    }
  }

  function settle(rec: TaskRecord, status: TaskStatus, error?: string): void {
    // 幂等：已终态的任务不得二次结算（dispose 与 execute 竞态 — review M5）
    if (rec.status !== 'running') return
    rec.status = status
    rec.finishedAt = Date.now()
    if (error !== undefined) rec.error = error
    if (status === 'success') rec.percent = 100
    cancelFns.delete(rec.taskId)
    emitProgress(rec)
    const set = waiters.get(rec.taskId)
    if (set) {
      waiters.delete(rec.taskId)
      for (const fn of set) fn(rec)
    }
    if (events.onFinish) {
      try {
        events.onFinish(rec)
      } catch (e) {
        events.logger.warn('task finish hook failed', { error: String(e) })
      }
    }
    trimFinished()
  }

  /** 淘汰最旧的终态记录，防 Map 无界增长 */
  function trimFinished(): void {
    const finished = [...tasks.values()].filter((t) => t.status !== 'running')
    const overflow = finished.length - MAX_FINISHED_RECORDS
    if (overflow <= 0) return
    finished
      .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt))
      .slice(0, overflow)
      .forEach((t) => tasks.delete(t.taskId))
  }

  function makeControl(rec: TaskRecord): TaskControl {
    return {
      taskId: rec.taskId,
      type: rec.type,
      distro: rec.distro,
      report(percent, message) {
        if (rec.status !== 'running') return
        const next = clampPercent(percent)
        if (next !== null) rec.percent = next
        if (message !== undefined && message !== '') rec.message = message
        emitProgress(rec)
      },
      log(line) {
        if (rec.status !== 'running') return
        rec.logs.push(line)
        if (rec.logs.length > MAX_LOG_LINES) rec.logs.splice(0, rec.logs.length - MAX_LOG_LINES)
        emitProgress(rec, line)
      },
      isCanceled() {
        // 协作风控必须同时看任务状态：dispose() 会清空 cancelRequested，
        // 只查 Set 会让退出窗口里的重活（大文件导出/迁移）继续跑出残局（review M-1）
        return rec.status !== 'running' || cancelRequested.has(rec.taskId)
      },
      throwIfCanceled() {
        if (rec.status !== 'running' || cancelRequested.has(rec.taskId)) {
          throw createAppError('TASK_CANCELED', {
            message: `任务已取消：${rec.type}${rec.distro ? ` ${rec.distro}` : ''}`,
          })
        }
      },
      onCancel(fn) {
        let set = cancelFns.get(rec.taskId)
        if (!set) {
          set = new Set()
          cancelFns.set(rec.taskId, set)
        }
        set.add(fn)
        // 已请求取消：立即执行，避免注册错过取消窗口
        if (cancelRequested.has(rec.taskId)) {
          try {
            fn()
          } catch {
            /* 清理失败不阻断 */
          }
        }
      },
    }
  }

  async function execute(rec: TaskRecord, run: (ctl: TaskControl) => Promise<void>): Promise<void> {
    started.add(rec.taskId)
    // 开跑前守卫：已请求取消 或 已被 dispose 结算的任务不得执行副作用
    // （dispose 会清空 cancelRequested，必须同时看 rec.status — 核验修复）
    if (cancelRequested.has(rec.taskId) || rec.status !== 'running') {
      cancelRequested.delete(rec.taskId)
      settle(rec, 'canceled', '任务在开始前被取消')
      return
    }
    const ctl = makeControl(rec)
    try {
      await run(ctl)
      // run 正常返回即成功（成功优先语义）：取消信号在收尾窗口到达
      // 不得把已完成任务改判为 canceled（核验修复）
      settle(rec, 'success')
    } catch (e) {
      const canceled = cancelRequested.has(rec.taskId)
      const isCancelErr =
        canceled ||
        (e !== null &&
          typeof e === 'object' &&
          'code' in e &&
          (e as { code: string }).code === 'TASK_CANCELED')
      if (isCancelErr) {
        settle(rec, 'canceled', e instanceof Error ? e.message : '任务已取消')
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        events.logger.warn('task failed', { taskId: rec.taskId, error: msg })
        settle(rec, 'failed', msg)
      }
    } finally {
      cancelRequested.delete(rec.taskId)
    }
  }

  function enqueue(
    rec: TaskRecord,
    lockKey: string | null | undefined,
    run: (ctl: TaskControl) => Promise<void>,
  ): void {
    const job = () => execute(rec, run)
    if (!lockKey) {
      void job()
      return
    }
    const prev = locks.get(lockKey) ?? Promise.resolve()
    // execute 吞掉所有异常 → 链不中断；前序失败不影响后继
    const next = prev.then(job, job)
    locks.set(
      lockKey,
      next.catch(() => {}),
    )
  }

  return {
    start(opts): TaskHandle {
      if (disposed) {
        throw createAppError('TASK_FAILED', { message: '任务调度器已关闭' })
      }
      const taskId = randomUUID()
      const rec: TaskRecord = {
        taskId,
        type: opts.type,
        distro: opts.distro,
        status: 'running',
        percent: null,
        message: opts.message,
        logs: [],
        startedAt: Date.now(),
      }
      tasks.set(taskId, rec)
      emitProgress(rec)
      enqueue(rec, opts.lockKey, opts.run)
      return { taskId }
    },

    cancel(taskId: string): boolean {
      const rec = tasks.get(taskId)
      if (!rec || rec.status !== 'running') return false
      cancelRequested.add(taskId)
      events.logger.info('task cancel requested', { taskId, type: rec.type })
      const set = cancelFns.get(taskId)
      if (set) {
        for (const fn of set) {
          try {
            fn()
          } catch (e) {
            events.logger.warn('task cancel hook failed', { taskId, error: String(e) })
          }
        }
      }
      // 排队中（lockKey 等待）的任务没有 cancelFns，必须立刻结算，
      // 否则要等前一个任务跑完才见效：waitFor 永挂、列表显示"运行中"，
      // 且与 dispose() 的立即结算语义不一致（review M-2）
      if (!started.has(taskId)) {
        cancelRequested.delete(taskId)
        settle(rec, 'canceled', '任务在开始前被取消')
      }
      return true
    },

    get(taskId) {
      return tasks.get(taskId) ?? null
    },

    list() {
      return [...tasks.values()]
    },

    waitFor(taskId) {
      const rec = tasks.get(taskId)
      if (!rec)
        return Promise.reject(createAppError('TASK_FAILED', { message: `任务不存在：${taskId}` }))
      if (rec.status !== 'running') return Promise.resolve(rec)
      return new Promise<TaskRecord>((resolve) => {
        let set = waiters.get(taskId)
        if (!set) {
          set = new Set()
          waiters.set(taskId, set)
        }
        set.add(resolve)
      })
    },

    dispose() {
      disposed = true
      for (const rec of tasks.values()) {
        if (rec.status === 'running') {
          cancelRequested.add(rec.taskId)
          const set = cancelFns.get(rec.taskId)
          if (set)
            for (const fn of set) {
              try {
                fn()
              } catch {
                /* ignore */
              }
            }
          settle(rec, 'canceled', '应用退出，任务终止')
        }
      }
      // 兜底清理，防残留状态（review M26）
      cancelRequested.clear()
      started.clear()
      cancelFns.clear()
      waiters.clear()
      locks.clear()
    },
  }
}
