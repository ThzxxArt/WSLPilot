import { describe, it, expect } from 'vitest'
import {
  collectActionVars,
  substituteActionVars,
  resolveActionInvocation,
  previewActionCommand,
  previewActionCommandForDistro,
  assertSafeActionId,
  type ActionVarContext,
} from './actions'
import type { WslAction } from './types'

const ctx: ActionVarContext = {
  distroName: 'Ubuntu-22.04',
  startupCwd: '/home/me/project',
  home: '/home/me',
  user: 'me',
}

const action: WslAction = {
  id: 'update-all',
  label: '全量更新',
  scope: 'distro',
  program: '/usr/bin/bash',
  args: ['-lc', 'sudo apt update && sudo apt upgrade -y'],
  user: 'root',
  cwd: '/',
  terminal: true,
  confirm: true,
}

describe('collectActionVars', () => {
  it('收集已知变量名，忽略未知', () => {
    expect(collectActionVars('${distroName} ${home} ${foo}')).toEqual(['distroName', 'home'])
    expect(collectActionVars('no vars')).toEqual([])
  })
})

describe('substituteActionVars', () => {
  it('替换四类占位符', () => {
    expect(substituteActionVars('${distroName}|${startupCwd}|${home}|${user}', ctx)).toBe(
      'Ubuntu-22.04|/home/me/project|/home/me|me',
    )
  })

  it('未知占位符原样保留', () => {
    expect(substituteActionVars('${foo}', ctx)).toBe('${foo}')
  })

  it('不含占位符的文本原样返回', () => {
    expect(substituteActionVars('echo hi', ctx)).toBe('echo hi')
  })
})

describe('resolveActionInvocation / previewActionCommand', () => {
  it('替换 program/args/cwd/user', () => {
    const a: WslAction = {
      ...action,
      program: '/bin/${user}/tool',
      args: ['-d', '${distroName}'],
      cwd: '${startupCwd}',
      user: '${user}',
    }
    const inv = resolveActionInvocation(a, ctx)
    expect(inv.program).toBe('/bin/me/tool')
    expect(inv.args).toEqual(['-d', 'Ubuntu-22.04'])
    expect(inv.cwd).toBe('/home/me/project')
    expect(inv.user).toBe('me')
  })

  it('缺省 user/cwd 保持 undefined', () => {
    const inv = resolveActionInvocation({ ...action, user: undefined, cwd: undefined }, ctx)
    expect(inv.user).toBeUndefined()
    expect(inv.cwd).toBeUndefined()
  })

  it('等价命令与真实执行形态一致（wsl -d … -e …）', () => {
    const cmd = previewActionCommand(action, ctx)
    expect(cmd).toContain('wsl.exe')
    expect(cmd).toContain('-d Ubuntu-22.04')
    expect(cmd).toContain('-u root')
    expect(cmd).toContain('--cd /')
    expect(cmd).toContain('-e /usr/bin/bash')
    expect(cmd).toContain('sudo apt update')
  })

  it('~ 与空 cwd 不进命令行', () => {
    const cmd = previewActionCommand({ ...action, cwd: '~', user: undefined }, ctx)
    expect(cmd).not.toContain('--cd')
    expect(cmd).not.toContain('-u')
    const cmd2 = previewActionCommand({ ...action, cwd: '   ' }, ctx)
    expect(cmd2).not.toContain('--cd')
  })

  it('变量在等价命令中已替换', () => {
    const a: WslAction = {
      ...action,
      args: ['${distroName}'],
      cwd: '${startupCwd}',
      user: undefined,
    }
    const cmd = previewActionCommand(a, ctx)
    expect(cmd).toContain('Ubuntu-22.04')
    expect(cmd).toContain('--cd /home/me/project')
    expect(cmd).not.toContain('${')
  })

  it('previewActionCommandForDistro 保留 ${home}/${user} 占位符', () => {
    const a: WslAction = {
      ...action,
      args: ['${home}', '${user}'],
      user: undefined,
      cwd: undefined,
    }
    const cmd = previewActionCommandForDistro(a, 'Debian', '/work')
    expect(cmd).toContain('-d Debian')
    expect(cmd).toContain('${home}')
    expect(cmd).toContain('${user}')
  })
})

describe('assertSafeActionId', () => {
  it('合法 id 原样返回', () => {
    expect(assertSafeActionId('update-all')).toBe('update-all')
    expect(assertSafeActionId('  spaced  ')).toBe('spaced')
  })

  it('拒绝空/超长/控制字符/文件名非法字符/非字符串', () => {
    expect(() => assertSafeActionId('')).toThrow()
    expect(() => assertSafeActionId('x'.repeat(101))).toThrow()
    expect(() => assertSafeActionId('a\u0000b')).toThrow()
    expect(() => assertSafeActionId('a/b')).toThrow()
    expect(() => assertSafeActionId('a:b')).toThrow()
    expect(() => assertSafeActionId(null)).toThrow()
    expect(() => assertSafeActionId(123)).toThrow()
  })
})
