import { createAppError } from '@wslpilot/shared'
import { getRawCommand, spawnWsl, type Logger } from '@wslpilot/kit'
import type { TaskControl } from './task-runner'

export type SpawnWslFn = typeof spawnWsl

/** 无输出看门狗：长时间静默视为挂死（review M4） */
export const WATCHDOG_IDLE_MS = 10 * 60 * 1000

/**
 * spawn 一条 wsl.exe 长命令：流式日志 → ctl，支持取消（kill）与无输出看门狗。
 * 取消语义（review M8）：进程已成功退出（exit 0）以成功为准；
 * 取消只在"启动后、退出前"生效，避免误回滚已完成任务。
 */
export function spawnWslTask(
  args: string[],
  ctl: TaskControl,
  logger: Logger,
  spawnFn: SpawnWslFn = spawnWsl,
): Promise<void> {
  const rawCommand = getRawCommand('wsl.exe', args)
  ctl.log(`$ ${rawCommand}`)
  return new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false
    let exited = false
    let exitCode: number | null = null
    let lastActivity = Date.now()
    let watchdogKilled = false
    const tail: string[] = []
    let handle: { kill(): void } | null = null

    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearInterval(watchdog)
      fn()
    }

    const watchdog = setInterval(() => {
      if (settled || exited) return
      if (Date.now() - lastActivity < WATCHDOG_IDLE_MS) return
      ctl.log(`命令 ${WATCHDOG_IDLE_MS / 60000} 分钟无输出，判定挂死并终止`)
      watchdogKilled = true
      handle?.kill()
      // kill 会同步触发 onExit → settleAfterExit；此处兜底（kill 无响应时）
      setTimeout(() => {
        done(() =>
          rejectPromise(
            createAppError('TASK_FAILED', {
              message: '命令长时间无响应，已自动终止',
              detail: tail.join('\n'),
              rawCommand,
              suggestion: '请检查 WSL 服务状态（wsl --status）后重试',
            }),
          ),
        )
      }, 100)
    }, 30_000)
    ;(watchdog as unknown as { unref?: () => void }).unref?.()

    const settleAfterExit = () => {
      if (exitCode === 0) {
        done(resolvePromise)
        return
      }
      if (ctl.isCanceled()) {
        done(() => rejectPromise(createAppError('TASK_CANCELED', { message: '任务已取消' })))
        return
      }
      if (watchdogKilled) {
        done(() =>
          rejectPromise(
            createAppError('TASK_FAILED', {
              message: '命令长时间无响应，已自动终止',
              detail: tail.join('\n'),
              rawCommand,
              suggestion: '请检查 WSL 服务状态（wsl --status）后重试',
            }),
          ),
        )
        return
      }
      done(() =>
        rejectPromise(
          createAppError('TASK_FAILED', {
            message: `命令执行失败（exit ${exitCode}）`,
            detail: tail.join('\n'),
            rawCommand,
          }),
        ),
      )
    }

    try {
      handle = spawnFn(args, {
        onLine: (line) => {
          lastActivity = Date.now()
          tail.push(line)
          if (tail.length > 20) tail.shift()
          ctl.log(line)
        },
        onExit: (code) => {
          exited = true
          exitCode = code
          lastActivity = Date.now()
          settleAfterExit()
        },
        onError: (err) => {
          lastActivity = Date.now()
          done(() =>
            rejectPromise(
              createAppError('TASK_FAILED', {
                message: `无法启动 wsl.exe：${err.message}`,
                detail: tail.join('\n'),
                rawCommand,
              }),
            ),
          )
        },
      })
      ctl.onCancel(() => handle?.kill())
    } catch (e) {
      logger.warn('spawn task setup failed', { error: String(e) })
      done(() => rejectPromise(e instanceof Error ? e : new Error(String(e))))
    }
  })
}
