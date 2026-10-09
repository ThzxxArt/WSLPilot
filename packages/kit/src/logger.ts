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
 * 按天滚动：logs/app-YYYYMMDD.log
 * M1 简化实现；后续可替换为 pino。
 */
export function createLogger(userDataDir: string, level: LogLevel = 'info'): Logger {
  let currentLevel = LEVELS[level]

  function timestamp(): string {
    return new Date().toISOString()
  }

  function dayKey(): string {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '')
  }

  async function write(lvl: string, msg: string, extra?: Record<string, unknown>): Promise<void> {
    // extra 不得覆盖关键字段；序列化失败/toJSON 返回 undefined 均降级为占位（核验修复）
    let extraJson = '{}'
    try {
      extraJson = JSON.stringify(extra ?? {}) ?? '{}'
    } catch {
      extraJson = JSON.stringify({ extraError: 'unserializable extra' })
    }
    let extraObj: Record<string, unknown> = {}
    try {
      extraObj = JSON.parse(extraJson) as Record<string, unknown>
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
    try {
      const dir = logsDir(userDataDir)
      await fs.mkdir(dir, { recursive: true })
      await fs.appendFile(join(dir, `app-${dayKey()}.log`), line, 'utf8')
    } catch {
      // 日志失败不应阻断主流程
    }
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
      void write(lvl, msg, extra)
    }
  }

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
