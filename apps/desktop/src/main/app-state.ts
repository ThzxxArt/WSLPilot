/** 应用退出状态标记 — 避免 tray / index 循环依赖 */
let quitting = false

export function isQuitting(): boolean {
  return quitting
}

export function markQuitting(): void {
  quitting = true
}
