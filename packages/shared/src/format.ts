/** KB 格式化 — 独立文件以便纳入覆盖率门禁（types.ts 被 exclude） */

/** KB → 人类可读 */
export function formatKb(kb: number): string {
  if (!kb || kb <= 0) return '—'
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)}T`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}G`
  return `${Math.round(kb)}K`
}

/** KB 双值 → "已用 / 总量" */
export function formatKbPair(usedKB: number, totalKB: number): string {
  if (!totalKB) return '—'
  return `${formatKb(usedKB)} / ${formatKb(totalKB)}`
}
