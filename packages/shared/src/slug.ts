/**
 * 白名单键（动作 id / 转发规则 id）安全校验的**唯一实现**。
 *
 * 此前 `assertSafeActionId`（actions.ts）与 `assertSafeRuleId`（network.ts）逐字重复两份，
 * 规则漂移风险真实存在 — review 0.1.2 收敛至此，两处仅保留语义化薄壳。
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
