import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LogLevel } from '@wslpilot/shared'
import { logsDir } from './paths'

const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
}

/** 日志保留策略（review 0.1.2）：最近 7 天，且总量不超过 5MB（超出从最旧删） */
export const LOG_RETENTION_DAYS = 7
export const LOG_RETENTION_MAX_BYTES = 5 * 1024 * 1024

/**
 * 本地时区日键 YYYYMMDD（独立导出便于单测）。
 * review 0.1.2 根治：不用 toISOString（UTC）—— 东八区凌晨 0-8 点会落错「昨天」文件。
 */
export function formatDayKey(at: Date): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export interface Logger {
  trace(msg: string, extra?: Record<string, unknown>): void
  debug(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
  setLevel(level: LogLevel): void
}

/**
 * 结构化文本日志（非数据库）。
 * 按天滚动：logs/app-YYYYMMDD.log（**本地时区**日界 — review 0.1.2 根治：
 * UTC 日键会让东八区用户在 08:00 前的日志落到"昨天"文件）。
 * M1 简化实现；后续可替换为 pino。
 */
export function createLogger(userDataDir: string, level: LogLevel = 'info'): Logger {
  let currentLevel = LEVELS[level]
  const dir = logsDir(userDataDir)

  function timestamp(): string {
    return new Date().toISOString()
  }

  function dayKey(): string {
    return formatDayKey(new Date())
  }

  /** 单队列串行 append（review 0.1.2 根治：并发写日志行会交错/丢行） */
  let queue: Promise<void> = Promise.resolve()
  function enqueue(line: string, file: string): void {
    queue = queue.then(async () => {
      try {
        await fs.mkdir(dir, { recursive: true })
        await fs.appendFile(file, line, 'utf8')
      } catch {
        // 日志失败不应阻断主流程
      }
    })
  }

  function write(lvl: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    // extra 不得覆盖关键字段；非对象 extra 包一层 { value }（review 0.1.2 根治：
    // 直接 spread 字符串/数字会产出 0:"x" 之类的乱字段）；
    // 序列化失败/toJSON 返回 undefined 均降级为占位（核验修复）
    let extraObj: Record<string, unknown> = {}
    try {
      if (
        extra !== undefined &&
        (typeof extra !== 'object' || extra === null || Array.isArray(extra))
      ) {
        extraObj = { value: extra }
      } else {
        const json = JSON.stringify(extra ?? {}) ?? '{}'
        const parsed = JSON.parse(json) as unknown
        extraObj =
          parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { value: parsed }
      }
    } catch {
      extraObj = { extraError: 'unserializable extra' }
    }
    const line =
      JSON.stringify({
        ...extraObj,
        time: timestamp(),
        level: lvl,
        msg,
      }) + '\n'
    enqueue(line, join(dir, `app-${dayKey()}.log`))
  }

  function make(lvl: LogLevel) {
    return (msg: string, extra?: Record<string, unknown>) => {
      if (LEVELS[lvl] < currentLevel) return
      const label = lvl.toUpperCase()
      if (lvl === 'error' || lvl === 'warn') {
        console.error(`[${label}]`, msg, extra ?? '')
      } else {
        console.log(`[${label}]`, msg, extra ?? '')
      }
      write(lvl, msg, extra)
    }
  }

  // 创建时执行一次保留清理（异步后台，不阻断启动）
  void cleanupOldLogs(dir)

  return {
    trace: make('trace'),
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    setLevel(l: LogLevel) {
      currentLevel = LEVELS[l]
    },
  }
}

/**
 * 保留清理（review 0.1.2）：
 * 1. 按**文件名日期**（本地时区日键）删除超过 LOG_RETENTION_DAYS 的日志；
 * 2. 删除后总量仍超 LOG_RETENTION_MAX_BYTES 时，从最旧开始删到不超为止；
 *    今日文件（可能在写）与保留集中最新一天永不参与总量删除（review 0.1.2 审计修复：
 *    此前今日大文件会被当「最旧可删」清掉，含正在写的数据）。
 * 失败静默（日志维护不阻断主流程）。
 */
async function cleanupOldLogs(dir: string): Promise<void> {
  try {
    const names = (await fs.readdir(dir)).filter((f) => /^app-\d{8}\.log$/.test(f)).sort()
    if (names.length === 0) return
    const todayName = `app-${formatDayKey(new Date())}.log`
    const cutoffMs = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const kept: Array<{ name: string; size: number }> = []
    for (const name of names) {
      if (name === todayName) {
        // 今日文件不参与年龄删除（防时钟回拨等极端场景把正在写的文件当过期删）
        try {
          kept.push({ name, size: (await fs.stat(join(dir, name))).size })
        } catch {
          /* 读不到则忽略 */
        }
        continue
      }
      const key = name.slice(4, 12)
      // 本地时区零点（与 dayKey 的本地日界一致）
      const at = new Date(
        Number(key.slice(0, 4)),
        Number(key.slice(4, 6)) - 1,
        Number(key.slice(6, 8)),
      ).getTime()
      if (Number.isFinite(at) && at < cutoffMs) {
        await fs.rm(join(dir, name), { force: true })
        continue
      }
      let size = 0
      try {
        size = (await fs.stat(join(dir, name))).size
      } catch {
        continue
      }
      kept.push({ name, size })
    }
    // 保留集中最后一项即最新一天：总量删除必须至少留下它（review 0.1.2 审计修复）
    const newestKept = kept.length > 0 ? kept[kept.length - 1]!.name : undefined
    let total = kept.reduce((s, f) => s + f.size, 0)
    for (const f of kept) {
      if (total <= LOG_RETENTION_MAX_BYTES) break
      if (f.name === todayName || f.name === newestKept) continue
      await fs.rm(join(dir, f.name), { force: true })
      total -= f.size
    }
  } catch {
    /* 清理失败不阻断 */
  }
}
