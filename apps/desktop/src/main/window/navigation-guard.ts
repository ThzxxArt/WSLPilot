/**
 * 导航与新窗口安全守卫（设计书 §14.1「禁止新建窗口；http(s) 转系统浏览器」）。
 *
 * 抽成独立模块是为了**可测**：这条安全控制此前内联在 index.ts / main-window.ts 两处，
 * 无任何绕过用例，且被覆盖率门禁的「所有 index.ts」排除规则永久豁免（review 测试假信心根治）。
 */
export interface UrlDecision {
  /** 是否交给系统浏览器打开 */
  openExternal: boolean
}

/**
 * URL 分类：
 * - `http://` / `https://` → 打开系统浏览器
 * - 其余（file: / javascript: / about: / 相对路径 / **大小写变体**）→ 一律不外开
 *
 * 大小写必须归一，否则 `HTTP://` 可绕过白名单。
 */
export function decideExternalUrl(rawUrl: string): UrlDecision {
  const url = String(rawUrl ?? '')
    .trim()
    .toLowerCase()
  return { openExternal: url.startsWith('https://') || url.startsWith('http://') }
}

export interface ShellLike {
  openExternal(url: string): Promise<unknown> | unknown
}

/** 外开失败不阻断安全守卫（同步抛错与 promise 拒绝都要吞掉） */
function safeOpenExternal(shell: ShellLike, url: string): void {
  try {
    void Promise.resolve(shell.openExternal(url)).catch(() => {})
  } catch {
    /* 安全守卫不能被外部打开失败反噬 */
  }
}

/** `setWindowOpenHandler` 回调：永远 deny（禁止 window.open 开新窗） */
export function makeWindowOpenHandler(
  shell: ShellLike,
): (details: { url: string }) => { action: 'deny' } {
  return ({ url }) => {
    if (decideExternalUrl(url).openExternal) safeOpenExternal(shell, url)
    return { action: 'deny' }
  }
}

/** `will-navigate` 回调：一律 preventDefault；http(s) 转系统浏览器 */
export function makeWillNavigateHandler(
  shell: ShellLike,
): (event: { preventDefault(): void }, url: string) => void {
  return (event, url) => {
    event.preventDefault()
    if (decideExternalUrl(url).openExternal) safeOpenExternal(shell, url)
  }
}
