import { describe, it, expect } from 'vitest'
import {
  ELEVATION_OPS,
  ELEVATION_PROGRAMS,
  ELEVATION_SUGGESTION,
  buildElevatedInvocation,
  buildElevationHelperPayload,
  isElevationError,
  isElevationOp,
  validateElevationRequest,
  type ElevationRequest,
} from './elevation'

describe('提权操作白名单（M7 §14.3）', () => {
  it('op ↔ program 映射完备（白名单即事实源）', () => {
    for (const op of ELEVATION_OPS) {
      expect(ELEVATION_PROGRAMS[op], `${op} 缺 program`).toBeTruthy()
      expect(isElevationOp(op)).toBe(true)
    }
    expect(isElevationOp('rm -rf /')).toBe(false)
    expect(isElevationOp('')).toBe(false)
    expect(isElevationOp(null)).toBe(false)
  })

  it('validateElevationRequest 拒绝任意命令行', () => {
    // 只想执行任意命令的请求到不了 Helper
    expect(() => validateElevationRequest({ op: 'exec', params: { cmd: 'rm -rf C:\\' } })).toThrow(
      /未知的提权操作/,
    )
    expect(() => validateElevationRequest({ op: 'netsh.portproxy.add' })).toThrow()
    expect(() => validateElevationRequest(null)).toThrow(/必须是对象/)
    expect(() => validateElevationRequest('cmd')).toThrow(/必须是对象/)
  })

  it('参数严格校验（.strict() 拒绝多余键；端口/地址校验）', () => {
    const ok: ElevationRequest = {
      op: 'netsh.portproxy.add',
      params: {
        listenAddress: '0.0.0.0',
        listenPort: 3000,
        connectAddress: '127.0.0.1',
        connectPort: 3000,
      },
    }
    expect(validateElevationRequest(ok).op).toBe('netsh.portproxy.add')
    expect(() =>
      validateElevationRequest({
        op: 'netsh.portproxy.add',
        params: { ...ok.params, evil: 'x' },
      }),
    ).toThrow()
    expect(() =>
      validateElevationRequest({
        op: 'netsh.portproxy.add',
        params: { ...ok.params, listenPort: 70000 },
      }),
    ).toThrow()
    expect(() =>
      validateElevationRequest({ op: 'usbipd.bind', params: { busId: 'x; rm -rf' } }),
    ).toThrow()
    expect(() =>
      validateElevationRequest({
        op: 'wsl.move',
        params: { name: 'Ubuntu', path: 'C:\\a\u0000b' },
      }),
    ).toThrow()
  })

  it('buildElevatedInvocation：参数数组、无 shell 拼接、等价命令可预览', () => {
    const inv = buildElevatedInvocation({
      op: 'netsh.portproxy.add',
      params: {
        listenAddress: '0.0.0.0',
        listenPort: 3000,
        connectAddress: '127.0.0.1',
        connectPort: 3000,
      },
    })
    expect(inv.program).toBe('netsh.exe')
    expect(inv.args).toEqual([
      'interface',
      'portproxy',
      'add',
      'v4tov4',
      'listenaddress=0.0.0.0',
      'listenport=3000',
      'connectaddress=127.0.0.1',
      'connectport=3000',
    ])
    expect(inv.preview).toContain('netsh.exe')

    const del = buildElevatedInvocation({
      op: 'netsh.portproxy.delete',
      params: { listenAddress: '127.0.0.1', listenPort: 8080 },
    })
    expect(del.args).toEqual([
      'interface',
      'portproxy',
      'delete',
      'v4tov4',
      'listenaddress=127.0.0.1',
      'listenport=8080',
    ])

    const bind = buildElevatedInvocation({ op: 'usbipd.bind', params: { busId: '1-2' } })
    expect(bind.program).toBe('usbipd.exe')
    expect(bind.args).toEqual(['bind', '--busid', '1-2'])

    const move = buildElevatedInvocation({
      op: 'wsl.move',
      params: { name: 'Ubuntu', path: 'D:\\WSL\\Ubuntu' },
    })
    expect(move.args).toEqual(['--manage', 'Ubuntu', '--move', 'D:\\WSL\\Ubuntu'])

    const install = buildElevatedInvocation({ op: 'wsl.install', params: {} })
    expect(install.args).toEqual(['--install'])

    const setVersion = buildElevatedInvocation({
      op: 'wsl.setVersion',
      params: { name: 'Ubuntu', version: 2 },
    })
    expect(setVersion.args).toEqual(['--set-version', 'Ubuntu', '2'])
  })

  it('buildElevationHelperPayload：批量合并一次提权会话（§14.3 合并 UAC）', () => {
    const payload = buildElevationHelperPayload([
      { op: 'usbipd.bind', params: { busId: '1-2' } },
      { op: 'usbipd.unbind', params: { busId: '2-3' } },
    ])
    expect(payload.v).toBe(1)
    expect(payload.ops).toHaveLength(2)
    expect(payload.ops[0]).toEqual({
      op: 'usbipd.bind',
      program: 'usbipd.exe',
      args: ['bind', '--busid', '1-2'],
    })
    expect(() => buildElevationHelperPayload([])).toThrow(/不能为空/)
  })

  it('isElevationError 识别中英文提权失败', () => {
    expect(isElevationError('The requested operation requires elevation')).toBe(true)
    expect(isElevationError('请求的操作需要提升(作为管理员运行)')).toBe(true)
    expect(isElevationError('Access is denied.')).toBe(true)
    expect(isElevationError('拒绝访问')).toBe(true)
    expect(isElevationError('ok')).toBe(false)
    expect(ELEVATION_SUGGESTION).toContain('管理员')
  })
})
