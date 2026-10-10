/**
 * 代码签名状态检测（M7 签名，设计书 §17）。
 *
 * - Windows：`Get-AuthenticodeSignature` 读取当前可执行文件的签名（PowerShell，参数数组执行）
 * - 未签名 / 非 Windows / 检测失败：给出**可读的 SmartScreen 说明**（界面直接展示，不吓用户）
 * - 签名本身由打包阶段完成（electron-builder：CSC_LINK / CSC_KEY_PASSWORD），本模块只做检测
 */
import type { SignatureStatus } from '@wslpilot/shared'
import { runTool, type Logger, type RunToolFn } from '@wslpilot/kit'

/** 未签名时的 SmartScreen 提示（唯一事实源，界面与文档共用） */
export const SMARTSCREEN_NOTE =
  '未签名的安装包在首次运行时可能出现 Windows SmartScreen 蓝色提示（"Windows 已保护你的电脑"）。点击「更多信息 → 仍要运行」即可继续；正式签名的发布版本不会出现该提示。'

export interface SignatureServiceDeps {
  logger: Logger
  runTool?: RunToolFn
  /** 被检测的可执行文件（默认 process.execPath） */
  exePath?: string
  isWindows?: boolean
}

export interface SignatureService {
  status(): Promise<SignatureStatus>
}

/**
 * 解析 `Get-AuthenticodeSignature … | ConvertTo-Json` 输出。
 * 输出形如：{ "Status": "Valid", "SignerCertificate": { "Subject": "CN=…" }, … }
 * 解析失败返回 null（宽容解析：PowerShell 本地化不影响 Status 键名）。
 */
export function parseAuthenticodeJson(text: string): {
  status: string
  subject?: string
} | null {
  try {
    const data = JSON.parse(text) as {
      Status?: unknown
      SignerCertificate?: { Subject?: unknown } | null
    }
    if (!data || typeof data !== 'object') return null
    const status = typeof data.Status === 'string' ? data.Status : ''
    if (!status) return null
    const subject =
      data.SignerCertificate && typeof data.SignerCertificate.Subject === 'string'
        ? data.SignerCertificate.Subject
        : undefined
    return { status, subject }
  } catch {
    return null
  }
}

/** Authenticode Status → 是否有效签名 */
export function isSignedStatus(status: string): boolean {
  return /^valid$/i.test(String(status ?? '').trim())
}

export function createSignatureService(deps: SignatureServiceDeps): SignatureService {
  const tool: RunToolFn = deps.runTool ?? runTool
  const exePath = deps.exePath ?? process.execPath
  const isWindows = deps.isWindows ?? process.platform === 'win32'

  async function status(): Promise<SignatureStatus> {
    if (!isWindows) {
      return {
        checked: false,
        signed: false,
        detail: '仅 Windows 平台检测代码签名',
        smartscreenNote: SMARTSCREEN_NOTE,
      }
    }
    // 单引号转义后内嵌到 PowerShell 表达式；execFile 传参数组，不经 cmd
    const quoted = `'${exePath.replace(/'/g, "''")}'`
    const command = `try { (Get-AuthenticodeSignature -FilePath ${quoted}) | ConvertTo-Json -Depth 4 -Compress } catch { $_.Exception.Message }`
    const r = await tool('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      timeoutMs: 15_000,
    })
    const text = `${r.stdout}`.trim()
    const parsed = parseAuthenticodeJson(text)
    if (!parsed) {
      deps.logger.warn('signature check failed', {
        code: r.code,
        detail: text.slice(0, 200) || r.stderr.slice(0, 200),
      })
      return {
        checked: false,
        signed: false,
        detail: text.slice(0, 300) || '签名检测未返回结果',
        smartscreenNote: SMARTSCREEN_NOTE,
      }
    }
    const signed = isSignedStatus(parsed.status)
    return {
      checked: true,
      signed,
      subject: parsed.subject,
      detail: parsed.status,
      smartscreenNote: signed ? undefined : SMARTSCREEN_NOTE,
    }
  }

  return { status }
}
