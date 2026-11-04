import { describe, it, expect } from 'vitest'
import {
  BASH_RC_TEMPLATE,
  SHELL_INTEGRATION_FILES,
  SHELL_INTEGRATION_VERSION,
  ZSH_RC_TEMPLATE,
  isShellIntegrationSupported,
  resolveShellKind,
  shellIntegrationDir,
  shellIntegrationLaunchArgs,
  shellIntegrationStatusFromProbe,
} from '../src/shell-integration'

describe('Shell 集成模板', () => {
  it('bash 模板包含 OSC 133/7 且先加载用户 rc', () => {
    expect(BASH_RC_TEMPLATE).toContain('133;A')
    expect(BASH_RC_TEMPLATE).toContain('133;B')
    expect(BASH_RC_TEMPLATE).toContain('133;C')
    expect(BASH_RC_TEMPLATE).toContain('133;D')
    expect(BASH_RC_TEMPLATE).toContain(']7;file://')
    expect(BASH_RC_TEMPLATE).toContain('. "$HOME/.bashrc"')
    expect(BASH_RC_TEMPLATE).toContain('PROMPT_COMMAND=')
    // 不修改用户 rc：模板自身只 source
    expect(BASH_RC_TEMPLATE).not.toContain('>> "$HOME/.bashrc"')
    expect(BASH_RC_TEMPLATE).not.toContain('tee -a')
  })

  it('zsh 模板通过 ZDOTDIR 接管并 source 原 zshrc', () => {
    expect(ZSH_RC_TEMPLATE).toContain('WSLPILOT_ORIGINAL_ZDOTDIR')
    expect(ZSH_RC_TEMPLATE).toContain('source "$HOME/.zshrc"')
    expect(ZSH_RC_TEMPLATE).toContain('precmd')
    expect(ZSH_RC_TEMPLATE).toContain('preexec')
    expect(ZSH_RC_TEMPLATE).toContain('133;D')
  })

  it('模板占位符已全部替换（不存在 @@{）', () => {
    expect(BASH_RC_TEMPLATE).not.toContain('@@{')
    expect(ZSH_RC_TEMPLATE).not.toContain('@@{')
    // 替换后应保留正常的 shell 变量展开
    expect(BASH_RC_TEMPLATE).toContain('${PROMPT_COMMAND:+')
    expect(ZSH_RC_TEMPLATE).toContain('${WSLPILOT_ORIGINAL_ZDOTDIR:-}')
  })

  it('文件清单固定在 ~/.wslpilot 下', () => {
    expect(SHELL_INTEGRATION_FILES.bashrc).toMatch(/^\.wslpilot\/shell-integration\//)
    expect(SHELL_INTEGRATION_FILES.zshrc).toMatch(/^\.wslpilot\/shell-integration\/zsh\//)
    expect(SHELL_INTEGRATION_FILES.version).toMatch(/^\.wslpilot\/shell-integration\//)
  })
})

describe('shell 类型与启动参数', () => {
  it('resolveShellKind 识别常见路径与裸名', () => {
    expect(resolveShellKind('/bin/bash')).toBe('bash')
    expect(resolveShellKind('/usr/bin/zsh')).toBe('zsh')
    expect(resolveShellKind('zsh')).toBe('zsh')
    expect(resolveShellKind('/usr/bin/fish')).toBe('fish')
    expect(resolveShellKind('/bin/sh')).toBe('unknown')
    expect(resolveShellKind('')).toBe('unknown')
    expect(resolveShellKind(undefined)).toBe('unknown')
  })

  it('仅 bash/zsh 支持自动安装', () => {
    expect(isShellIntegrationSupported('/bin/bash')).toBe(true)
    expect(isShellIntegrationSupported('/bin/zsh')).toBe(true)
    expect(isShellIntegrationSupported('/usr/bin/fish')).toBe(false)
    expect(isShellIntegrationSupported('pwsh')).toBe(false)
  })

  it('bash 启动参数使用 --rcfile 且不拼接命令字符串', () => {
    const r = shellIntegrationLaunchArgs('/bin/bash', '/home/me')
    expect(r.integrated).toBe(true)
    expect(r.args).toEqual([
      '-e',
      '/bin/bash',
      '--rcfile',
      '/home/me/.wslpilot/shell-integration/bashrc',
      '-i',
    ])
  })

  it('zsh 启动参数注入 ZDOTDIR 与原始 home', () => {
    const r = shellIntegrationLaunchArgs('/usr/bin/zsh', '/home/me/')
    expect(r.integrated).toBe(true)
    expect(r.args).toEqual([
      '-e',
      'env',
      'ZDOTDIR=/home/me/.wslpilot/shell-integration/zsh',
      'WSLPILOT_ORIGINAL_ZDOTDIR=/home/me',
      '/usr/bin/zsh',
      '-i',
    ])
  })

  it('不支持的 shell 退化为原始启动参数', () => {
    expect(shellIntegrationLaunchArgs('/usr/bin/fish', '/home/me')).toEqual({
      args: ['-e', '/usr/bin/fish'],
      integrated: false,
    })
    expect(shellIntegrationLaunchArgs('/bin/sh', '/home/me').integrated).toBe(false)
  })

  it('目录拼接去掉 home 末尾斜杠', () => {
    expect(shellIntegrationDir('/home/me/')).toBe('/home/me/.wslpilot/shell-integration')
    expect(shellIntegrationDir('/root')).toBe('/root/.wslpilot/shell-integration')
  })
})

describe('shellIntegrationStatusFromProbe', () => {
  const installedProbe = {
    home: '/home/me',
    files: { bashrc: true, zshrc: true },
    version: SHELL_INTEGRATION_VERSION,
  }

  it('bash 目标已安装且版本一致 → installed', () => {
    const s = shellIntegrationStatusFromProbe('Ubuntu', '/bin/bash', installedProbe)
    expect(s.state).toBe('installed')
    expect(s.supported).toBe(true)
    expect(s.shell).toBe('bash')
    expect(s.path).toBe('/home/me/.wslpilot/shell-integration')
  })

  it('zsh 目标文件在且版本一致 → installed', () => {
    expect(shellIntegrationStatusFromProbe('Ubuntu', '/usr/bin/zsh', installedProbe).state).toBe(
      'installed',
    )
  })

  it('文件存在但版本不匹配 → partial（提示修复）', () => {
    const s = shellIntegrationStatusFromProbe('Ubuntu', '/bin/bash', {
      ...installedProbe,
      version: '0',
    })
    expect(s.state).toBe('partial')
    expect(s.version).toBe('0')
    expect(s.expectedVersion).toBe(SHELL_INTEGRATION_VERSION)
  })

  it('只装了另一种 shell → partial', () => {
    const s = shellIntegrationStatusFromProbe('Ubuntu', '/bin/zsh', {
      home: '/home/me',
      files: { bashrc: true, zshrc: false },
      version: SHELL_INTEGRATION_VERSION,
    })
    expect(s.state).toBe('partial')
  })

  it('什么都没装 → missing', () => {
    const s = shellIntegrationStatusFromProbe('Ubuntu', '/bin/bash', {
      home: '/home/me',
      files: { bashrc: false, zshrc: false },
      version: '',
    })
    expect(s.state).toBe('missing')
  })

  it('fish / sh → unsupported（即使目录存在）', () => {
    expect(shellIntegrationStatusFromProbe('Ubuntu', '/usr/bin/fish', installedProbe).state).toBe(
      'unsupported',
    )
    expect(shellIntegrationStatusFromProbe('Ubuntu', '/bin/sh', installedProbe).state).toBe(
      'unsupported',
    )
  })
})
