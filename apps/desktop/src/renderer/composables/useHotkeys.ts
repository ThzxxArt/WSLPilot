/**
 * 全局快捷键（设计书 §11.5）— M5 命令面板与键盘全覆盖，0.1.3 补终端分屏/标签切换。
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
  /** Ctrl/⌘ + Shift + T：新建终端标签（终端内也可用 — 0.1.3） */
  newTerminalTab?: () => void
  /** Ctrl + Tab：下一个终端标签（终端内也可用 — 0.1.3） */
  nextTerminalTab?: () => void
  /** Ctrl + Shift + Tab：上一个终端标签 */
  prevTerminalTab?: () => void
  /** Ctrl/⌘ + Shift + 5：左右分屏（0.1.3） */
  splitTerminalRow?: () => void
  /** Ctrl/⌘ + Shift + 6：上下分屏（0.1.3） */
  splitTerminalCol?: () => void
}

/** 设置页快捷键说明（唯一事实源） */
export const HOTKEY_TABLE: Array<{ id: string; keys: string[]; label: string }> = [
  { id: 'palette', keys: ['Ctrl', 'K'], label: '打开命令面板' },
  { id: 'newTerminal', keys: ['Ctrl', 'N'], label: '新建终端标签' },
  { id: 'newTerminalTab', keys: ['Ctrl', 'Shift', 'T'], label: '新建终端标签（终端内可用）' },
  { id: 'switchTabCycle', keys: ['Ctrl', 'Tab'], label: '循环切换终端标签' },
  { id: 'splitRow', keys: ['Ctrl', 'Shift', '5'], label: '终端左右分屏' },
  { id: 'splitCol', keys: ['Ctrl', 'Shift', '6'], label: '终端上下分屏' },
  { id: 'openSettings', keys: ['Ctrl', ','], label: '打开设置' },
  { id: 'refresh', keys: ['Ctrl', 'R'], label: '刷新发行版列表' },
  { id: 'toggleRawCommand', keys: ['Ctrl', 'Shift', 'P'], label: '显示/隐藏等价命令行' },
  { id: 'switchTab', keys: ['Ctrl', '1…9'], label: '切换终端标签' },
]

type KeyTarget = {
  addEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void
  removeEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void
}

/**
 * 输入上下文守卫：焦点在输入控件 / contenteditable / xterm 终端内时，
 * Ctrl+K/N/R/1-9 等快捷键属于「打字语境」，绝不能被全局快捷键劫持
 * （否则 xterm 里清屏/换行/重绘全被抢走）。
 *
 * 例外（0.1.3）：Ctrl+Shift+T / Ctrl+Tab / Ctrl+Shift+5/6 在终端内也应生效
 * （与 VS Code 集成终端同语义，xterm 不会把这些组合送给 shell 做正常输入）。
 */
export function isTypingContext(target: EventTarget | null): boolean {
  if (!target) return false
  const el = target as Element
  if (typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable], .xterm, .xterm-helper-textarea')
}

function matchHotkey(e: KeyboardEvent, h: HotkeyHandlers): boolean {
  // 长按不连发（review 0.1.2 根治）：keydown 自动重复事件不再反复触发动作
  if (e.repeat) return false
  const mod = e.ctrlKey || e.metaKey

  // ── 终端内也生效的组合（先于 typing-context 守卫）──
  if (mod && !e.altKey && e.shiftKey && e.code === 'KeyT') {
    h.newTerminalTab?.()
    return true
  }
  if (mod && !e.altKey && e.key === 'Tab') {
    if (e.shiftKey) h.prevTerminalTab?.()
    else h.nextTerminalTab?.()
    return true
  }
  if (mod && !e.altKey && e.shiftKey && e.code === 'Digit5') {
    h.splitTerminalRow?.()
    return true
  }
  if (mod && !e.altKey && e.shiftKey && e.code === 'Digit6') {
    h.splitTerminalCol?.()
    return true
  }

  if (isTypingContext(e.target)) return false
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
  if (key === ',' && !e.shiftKey) {
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
