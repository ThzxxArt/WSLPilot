/**
 * 转发规则 id 的白名单校验（`assertSafeRuleId` 的唯一实现）。
 *
 * 动作 id 使用自己的 `assertSafeActionId`：兼容 0.1.3 的 `git:pull` 等 legacy id，
 * 仅额外允许 `:`，其余仍禁止路径/控制字符。两者不再共享“文件名非法字符”规则。
 * 规则：非空（trim 后）、长度 1–100、无控制字符、无文件名非法字符（`\ / : * ? " < > |`）。
 */
import { createAppError } from './errors'

// eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const BAD_CHARS = /[\\/:*?"<>|]/

export function assertSafeSlugId(id: unknown, label: string): string {
  const s = typeof id === 'string' ? id.trim() : ''
  const bad = (msg: string): never => {
    throw createAppError('CONFIG_INVALID', {
      message: msg,
      suggestion: `${label}不得包含 \\ / : * ? " < > | 或控制字符，长度 1–100`,
    })
  }
  if (!s || s.length > 100) bad(`${label} 非法（空或超过 100 字符）`)
  if (CONTROL_CHARS.test(s)) bad(`${label} 非法（含控制字符）`)
  if (BAD_CHARS.test(s)) bad(`${label} 非法（含非法字符）`)
  return s
}
