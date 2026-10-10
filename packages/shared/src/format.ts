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

/** 字节 → 人类可读（备份文件体积） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1)}${units[i]}`
}

/** WSL 发行版状态中文文案（唯一事实源，renderer 与 ui 组件共用） */
export function stateLabel(s: string): string {
  switch (s) {
    case 'Running':
      return '运行中'
    case 'Stopped':
      return '已停止'
    case 'Installing':
      return '安装中'
    case 'Uninstalling':
      return '卸载中'
    case 'Converting':
      return '转换中'
    case 'Unknown':
      return '未知'
    default:
      return s || '未知'
  }
}

/**
 * 发行版图标 → emoji（`distros.jsonc` 的 `DistroMeta.icon` 唯一消费点）。
 * 此前该字段「能写不能看」：详情页可编辑但卡片永远显示 🐧（幽灵字段根治）。
 */
const ICON_EMOJI: Record<string, string> = {
  ubuntu: '🐧',
  debian: '🌀',
  fedora: '🎩',
  alpine: '🏔️',
  arch: '⛰️',
  manjaro: '🌿',
  opensuse: '🦎',
  suse: '🦎',
  kali: '🐉',
  mint: '🍃',
  raspbian: '🍓',
  oracle: '🔴',
  rocky: '🪨',
  alma: '⚪',
  centos: '💠',
  gentoo: '🦊',
  void: '⬛',
  nixos: '❄️',
  docker: '🐳',
  linux: '🐧',
}

/**
 * 解析图标：`meta.icon` 优先（显式声明压过推断），其次发行版名前缀，最后 🐧。
 * 未识别的图标名回退 🐧，不抛错。
 */
export function distroIconEmoji(icon?: string, name?: string): string {
  const pick = (s: string | undefined): string | undefined => {
    const key = String(s ?? '')
      .trim()
      .toLowerCase()
      .split(/[-_\s]/)[0]
    return key ? ICON_EMOJI[key] : undefined
  }
  return pick(icon) ?? pick(name) ?? '🐧'
}
