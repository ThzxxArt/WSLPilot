/**
 * 窗口关闭策略（纯函数，便于单测 —— 覆盖率对 main/index.ts 入口的盲区）
 */
export type CloseBehavior = 'minimizeToTray' | 'quit'

export interface CloseDecision {
  action: 'hide' | 'quit' | 'allow'
  reason: string
}

/**
 * 同步决策，必须在 close 事件同步派发期内调用 preventDefault。
 * @param behavior 用户设置
 * @param quitting 是否已标记真正退出
 */
export function decideClose(behavior: CloseBehavior, quitting: boolean): CloseDecision {
  if (quitting) return { action: 'allow', reason: 'quitting' }
  if (behavior === 'minimizeToTray') {
    return { action: 'hide', reason: 'minimizeToTray' }
  }
  return { action: 'quit', reason: 'closeBehavior:quit' }
}
