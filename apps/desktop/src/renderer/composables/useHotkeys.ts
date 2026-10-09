/**
 * 全局快捷键（设计书 §11.5）— M5 命令面板与键盘全覆盖。
 * 纯事件绑定，可单测（target 可注入）。
 */

export interface HotkeyHandlers {
  /** Ctrl/⌘ + K */
  openPalette?: () => void
  /** Ctrl/⌘ + N */
  newTerminal?: () => void
  /** Ctrl/⌘ + , */
  openSettings?: () => void
  /** Ctrl/⌘ + R */
  refresh?: () => void
  /** Ctrl/⌘ + Shift + P */
  toggleRawCommand?: () => void
  /** Ctrl/⌘ + 1..9（index 为 0 基） */
  switchTab?: (index: number) => void
}

/** 设置页快捷键说明（唯一事实源） */
export const HOTKEY_TABLE: Array<{ id: string; keys: string[]; label: string }> = [
  { id: 'palette', keys: ['Ctrl', 'K'], label: '打开命令面板' },
  { id: 'newTerminal', keys: ['Ctrl', 'N'], label: '新建终端标签' },
  { id: 'openSettings', keys: ['Ctrl', ','], label: '打开设置' },
  { id: 'refresh', keys: ['Ctrl', 'R'], label: '刷新发行版列表' },
  { id: 'toggleRawCommand', keys: ['Ctrl', 'Shift', 'P'], label: '显示/隐藏等价命令行' },
  { id: 'switchTab', keys: ['Ctrl', '1…9'], label: '切换终端标签' },
]

type KeyTarget = {
  addEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void
  removeEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void
}

function matchHotkey(e: KeyboardEvent, h: HotkeyHandlers): boolean {
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.altKey) return false
  const key = e.key
  if (key.toLowerCase() === 'k' && !e.shiftKey) {
    h.openPalette?.()
    return true
  }
  if (key.toLowerCase() === 'n' && !e.shiftKey) {
    h.newTerminal?.()
    return true
  }
  if (key === ',') {
    h.openSettings?.()
    return true
  }
  if (key.toLowerCase() === 'r' && !e.shiftKey) {
    h.refresh?.()
    return true
  }
  if (key.toLowerCase() === 'p' && e.shiftKey) {
    h.toggleRawCommand?.()
    return true
  }
  if (!e.shiftKey && key >= '1' && key <= '9') {
    h.switchTab?.(Number(key) - 1)
    return true
  }
  return false
}

/** 绑定全局快捷键；返回解绑函数 */
export function bindGlobalHotkeys(
  handlers: HotkeyHandlers,
  target: KeyTarget = globalThis.window as unknown as KeyTarget,
): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (matchHotkey(e, handlers)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  target.addEventListener('keydown', onKey)
  return () => target.removeEventListener('keydown', onKey)
}
