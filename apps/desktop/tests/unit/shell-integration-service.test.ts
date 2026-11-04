import { describe, it, expect, vi } from 'vitest'
import { BASH_RC_TEMPLATE, SHELL_INTEGRATION_VERSION, ZSH_RC_TEMPLATE } from '@wslpilot/shared'
import { createShellIntegrationService } from '../../src/main/services/shell-integration-service'
import type { Logger } from '@wslpilot/kit'

function mockLogger(): Logger {
  const noop = () => {}
  return { trace: noop, debug: noop, info: noop, warn: noop, error: noop, setLevel: noop }
}

const HOME = '/home/me'
const DIR = `${HOME}/.wslpilot/shell-integration`

interface Scenario {
  home?: string
  homeCode?: number
  files?: Record<string, boolean>
  version?: string
  mkdirCode?: number
  writeCode?: number
  rmCode?: number
}

function makeDeps(scenario: Scenario = {}) {
  const files = scenario.files ?? {}
  const runWsl = vi.fn(async (args: string[]) => {
    const cmd = args.slice(3) // -d <distro> -e <cmd> ...
    if (cmd[0] === 'printenv') {
      return { stdout: scenario.home ?? HOME, stderr: '', code: scenario.homeCode ?? 0 }
    }
    if (cmd[0] === 'test' && cmd[1] === '-f') {
      return { stdout: '', stderr: '', code: files[cmd[2]!] ? 0 : 1 }
    }
    if (cmd[0] === 'cat') {
      return { stdout: scenario.version ?? '', stderr: '', code: 0 }
    }
    if (cmd[0] === 'mkdir') {
      return { stdout: '', stderr: '', code: scenario.mkdirCode ?? 0 }
    }
    if (cmd[0] === 'rm') {
      return { stdout: '', stderr: '', code: scenario.rmCode ?? 0 }
    }
    return { stdout: '', stderr: '', code: 0 }
  })
  const writes: Array<{ path: string; content: string }> = []
  const runWslWithStdin = vi.fn(async (args: string[], input: string) => {
    writes.push({ path: args[args.length - 1]!, content: input })
    return {
      stdout: '',
      stderr: scenario.writeCode ? 'permission denied' : '',
      code: scenario.writeCode ?? 0,
    }
  })
  return { runWsl, runWslWithStdin, writes }
}

describe('ShellIntegrationService', () => {
  it('status：已安装且版本一致', async () => {
    const deps = makeDeps({
      files: { [`${DIR}/bashrc`]: true, [`${DIR}/zsh/.zshrc`]: true },
      version: SHELL_INTEGRATION_VERSION,
    })
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    const s = await svc.status('Ubuntu', '/bin/bash')
    expect(s.state).toBe('installed')
    expect(s.path).toBe(DIR)
    // 所有调用都是 argv 数组，没有 shell -c 字符串拼接
    for (const call of deps.runWsl.mock.calls) {
      expect(call[0]).not.toContain('-c')
    }
  })

  it('status：未安装 → missing；zsh 只装 bash → partial', async () => {
    const deps = makeDeps({ files: {} })
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    expect((await svc.status('Ubuntu', '/bin/bash')).state).toBe('missing')

    const deps2 = makeDeps({
      files: { [`${DIR}/bashrc`]: true },
      version: SHELL_INTEGRATION_VERSION,
    })
    const svc2 = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps2.runWsl as never,
      runWslWithStdin: deps2.runWslWithStdin as never,
    })
    expect((await svc2.status('Ubuntu', '/usr/bin/zsh')).state).toBe('partial')
  })

  it('install：mkdir → 写 3 个固定文件（bashrc/zshrc/version）', async () => {
    const deps = makeDeps({})
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    await svc.install('Ubuntu', '/bin/bash')
    const mkdirCall = deps.runWsl.mock.calls.find((c) => c[0][3] === 'mkdir')
    expect(mkdirCall?.[0]).toEqual(['-d', 'Ubuntu', '-e', 'mkdir', '-p', `${DIR}/zsh`])
    expect(deps.writes.map((w) => w.path)).toEqual([
      `${DIR}/bashrc`,
      `${DIR}/zsh/.zshrc`,
      `${DIR}/version`,
    ])
    expect(deps.writes[0]!.content).toBe(BASH_RC_TEMPLATE)
    expect(deps.writes[1]!.content).toBe(ZSH_RC_TEMPLATE)
    expect(deps.writes[2]!.content).toBe(SHELL_INTEGRATION_VERSION)
  })

  it('install：mkdir 失败 / 写文件失败 → TASK_FAILED 带 detail', async () => {
    const deps = makeDeps({ mkdirCode: 1 })
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    await expect(svc.install('Ubuntu')).rejects.toMatchObject({ code: 'TASK_FAILED' })

    const deps2 = makeDeps({ writeCode: 1 })
    const svc2 = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps2.runWsl as never,
      runWslWithStdin: deps2.runWslWithStdin as never,
    })
    await expect(svc2.install('Ubuntu')).rejects.toMatchObject({
      code: 'TASK_FAILED',
      detail: expect.stringContaining('permission denied'),
    })
  })

  it('remove：rm -rf 固定目录并返回 missing', async () => {
    const deps = makeDeps({ files: {} })
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    const s = await svc.remove('Ubuntu')
    expect(s.state).toBe('missing')
    expect(deps.runWsl.mock.calls.some((c) => c[0].slice(3).join(' ') === `rm -rf ${DIR}`)).toBe(
      true,
    )
  })

  it('remove 失败 → TASK_FAILED', async () => {
    const deps = makeDeps({ rmCode: 1 })
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    await expect(svc.remove('Ubuntu')).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('home 探测失败 → TASK_FAILED；非法 home → INVALID_ARGUMENT', async () => {
    const deps = makeDeps({ homeCode: 1 })
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    await expect(svc.status('Ubuntu')).rejects.toMatchObject({ code: 'TASK_FAILED' })

    const deps2 = makeDeps({ home: 'relative/path' })
    const svc2 = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps2.runWsl as never,
      runWslWithStdin: deps2.runWslWithStdin as never,
    })
    await expect(svc2.status('Ubuntu')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('home 缓存：60s 内只探测一次；invalidateCache 后重新探测', async () => {
    const deps = makeDeps({})
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    await svc.homeDir('Ubuntu')
    await svc.homeDir('Ubuntu')
    const probes = () => deps.runWsl.mock.calls.filter((c) => c[0][3] === 'printenv').length
    expect(probes()).toBe(1)
    svc.invalidateCache('Ubuntu')
    await svc.homeDir('Ubuntu')
    expect(probes()).toBe(2)
    svc.invalidateCache()
    await svc.homeDir('Ubuntu')
    expect(probes()).toBe(3)
  })
})

describe('ShellIntegrationService stdout 错误回退', () => {
  it('mkdir/写入/删除失败且 stderr 为空时使用 stdout 作为 detail', async () => {
    const runWsl = vi.fn(async (args: string[]) => {
      const cmd = args.slice(3)
      if (cmd[0] === 'printenv') return { stdout: HOME, stderr: '', code: 0 }
      if (cmd[0] === 'test') return { stdout: '', stderr: '', code: 1 }
      if (cmd[0] === 'cat') return { stdout: '', stderr: '', code: 1 }
      return { stdout: `${cmd[0]} failed on stdout`, stderr: '', code: 1 }
    })
    const runWslWithStdin = vi.fn(async () => ({
      stdout: 'write failed on stdout',
      stderr: '',
      code: 1,
    }))
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: runWsl as never,
      runWslWithStdin: runWslWithStdin as never,
    })
    await expect(svc.install('Ubuntu')).rejects.toMatchObject({
      code: 'TASK_FAILED',
      detail: expect.stringContaining('mkdir failed on stdout'),
    })

    // mkdir 成功、写入失败：走 stdout 分支
    runWsl.mockImplementation(async (args: string[]) => {
      const cmd = args.slice(3)
      if (cmd[0] === 'mkdir' || cmd[0] === 'printenv')
        return { stdout: cmd[0] === 'printenv' ? HOME : '', stderr: '', code: 0 }
      if (cmd[0] === 'rm') return { stdout: 'rm failed on stdout', stderr: '', code: 1 }
      return { stdout: '', stderr: '', code: 1 }
    })
    await expect(svc.install('Ubuntu')).rejects.toMatchObject({
      detail: expect.stringContaining('write failed on stdout'),
    })
    await expect(svc.remove('Ubuntu')).rejects.toMatchObject({
      detail: expect.stringContaining('rm failed on stdout'),
    })
  })
})

describe('ShellIntegrationService 默认 shell 参数', () => {
  it('status/install/remove 省略 shell 时默认按 bash 判定', async () => {
    const deps = makeDeps({
      files: { [`${DIR}/bashrc`]: true, [`${DIR}/zsh/.zshrc`]: true },
      version: SHELL_INTEGRATION_VERSION,
    })
    const svc = createShellIntegrationService({
      logger: mockLogger(),
      runWsl: deps.runWsl as never,
      runWslWithStdin: deps.runWslWithStdin as never,
    })
    expect((await svc.status('Ubuntu')).shell).toBe('bash')
    expect((await svc.install('Ubuntu')).state).toBe('installed')
    await expect(svc.remove('Ubuntu')).resolves.toBeTruthy()
    svc.invalidateCache()
  })
})
