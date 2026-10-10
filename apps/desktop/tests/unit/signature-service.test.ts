import { describe, it, expect, vi } from 'vitest'
import {
  createSignatureService,
  isSignedStatus,
  parseAuthenticodeJson,
  SMARTSCREEN_NOTE,
} from '../../src/main/services/signature-service'

const logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  setLevel: vi.fn(),
}

describe('签名状态解析（M7 §17）', () => {
  it('parseAuthenticodeJson：Valid + 证书主题', () => {
    const parsed = parseAuthenticodeJson(
      JSON.stringify({
        Status: 'Valid',
        SignerCertificate: { Subject: 'CN=WSLPilot' },
      }),
    )
    expect(parsed).toEqual({ status: 'Valid', subject: 'CN=WSLPilot' })
    expect(isSignedStatus('Valid')).toBe(true)
    expect(isSignedStatus('valid')).toBe(true)
  })

  it('NotSigned / HashMismatch 不算有效签名', () => {
    expect(isSignedStatus('NotSigned')).toBe(false)
    expect(isSignedStatus('HashMismatch')).toBe(false)
    const parsed = parseAuthenticodeJson(JSON.stringify({ Status: 'NotSigned' }))
    expect(parsed).toEqual({ status: 'NotSigned', subject: undefined })
  })

  it('损坏输出返回 null（宽容解析）', () => {
    expect(parseAuthenticodeJson('not json')).toBeNull()
    expect(parseAuthenticodeJson('')).toBeNull()
    expect(parseAuthenticodeJson(JSON.stringify({ SignerCertificate: {} }))).toBeNull()
    expect(parseAuthenticodeJson(JSON.stringify(null))).toBeNull()
  })
})

describe('签名服务', () => {
  it('非 Windows：未检测 + SmartScreen 说明', async () => {
    const svc = createSignatureService({ logger, isWindows: false })
    const s = await svc.status()
    expect(s.checked).toBe(false)
    expect(s.signed).toBe(false)
    expect(s.smartscreenNote).toBe(SMARTSCREEN_NOTE)
  })

  it('Windows 已签名：无 SmartScreen 说明', async () => {
    const runTool = vi.fn(async (_program: string, _args: string[]) => ({
      stdout: JSON.stringify({ Status: 'Valid', SignerCertificate: { Subject: 'CN=X' } }),
      stderr: '',
      code: 0,
    }))
    const svc = createSignatureService({
      logger,
      runTool,
      isWindows: true,
      exePath: 'C:\\app\\WSLPilot.exe',
    })
    const s = await svc.status()
    expect(s.checked).toBe(true)
    expect(s.signed).toBe(true)
    expect(s.subject).toBe('CN=X')
    expect(s.smartscreenNote).toBeUndefined()
    // 检测走 PowerShell（参数数组，不经 cmd）
    expect(runTool.mock.calls[0]![0]).toBe('powershell.exe')
    expect(String(runTool.mock.calls[0]![1].join(' '))).toContain('Get-AuthenticodeSignature')
  })

  it('Windows 未签名：带 SmartScreen 说明', async () => {
    const runTool = vi.fn(async () => ({
      stdout: JSON.stringify({ Status: 'NotSigned' }),
      stderr: '',
      code: 0,
    }))
    const svc = createSignatureService({ logger, runTool, isWindows: true })
    const s = await svc.status()
    expect(s.signed).toBe(false)
    expect(s.smartscreenNote).toBe(SMARTSCREEN_NOTE)
  })

  it('检测失败：checked=false 并保留说明（不吓用户）', async () => {
    const runTool = vi.fn(async () => ({ stdout: 'boom', stderr: 'err', code: -1 }))
    const svc = createSignatureService({ logger, runTool, isWindows: true })
    const s = await svc.status()
    expect(s.checked).toBe(false)
    expect(s.smartscreenNote).toBe(SMARTSCREEN_NOTE)
    expect(logger.warn).toHaveBeenCalled()
  })
})
