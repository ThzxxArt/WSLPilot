import { describe, it, expect, vi } from 'vitest'
import {
  createActionRunner,
  findAction,
  actionTaskHandle,
  type ActionConfigReader,
} from '../../src/main/services/action-runner'
import type { WslAction, DistroMeta } from '@wslpilot/shared'
import type { TaskControl } from '../../src/main/services/task-runner'

function logger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  } as any
}

const updateAll: WslAction = {
  id: 'update-all',
  label: '全量更新',
  scope: 'distro',
  program: '/usr/bin/bash',
  args: ['-lc', 'sudo apt update'],
  user: 'root',
  cwd: '/',
  terminal: false,
  confirm: true,
}

const openCode: WslAction = {
  id: 'open-code',
  label: '打开项目',
  scope: 'distro',
  program: '/usr/bin/code',
  args: ['.'],
  cwd: '${startupCwd}',
  terminal: true,
  confirm: false,
}

const whoami: WslAction = {
  id: 'whoami',
  label: '我是谁',
  scope: 'global',
  program: '/usr/bin/id',
  args: ['${user}'],
  terminal: false,
  confirm: false,
}

function makeConfigReader(actions: WslAction[] = [updateAll, openCode, whoami]) {
  const metas: DistroMeta[] = [
    {
      name: 'Ubuntu',
      alias: '',
      tags: [],
      color: '',
      icon: 'ubuntu',
      note: '',
      startupCwd: '/home/me/proj',
      pinned: false,
      quickActions: [],
    },
  ]
  const reader = {
    loadSync: (key: string) =>
      key === 'actions' ? { $schemaVersion: 1, actions } : { $schemaVersion: 1, distros: metas },
  }
  return reader as unknown as ActionConfigReader
}

function makeCtl(over: Partial<TaskControl> = {}): TaskControl {
  return {
    taskId: 't1',
    type: 'action',
    distro: 'Ubuntu',
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: () => {},
    onCancel: vi.fn(),
    ...over,
  }
}

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    logger: logger(),
    configService: makeConfigReader(),
    wsl: {
      list: vi.fn(async () => [
        { name: 'Ubuntu', isDefault: true },
        { name: 'Debian', isDefault: false },
      ]),
    },
    pty: {
      createCommand: vi.fn(() => ({ ptyId: 'pty-1', distro: 'Ubuntu', shell: 'p', createdAt: 0 })),
      waitExit: vi.fn(async () => 0),
      kill: vi.fn(),
    },
    runWsl: vi.fn(async () => ({ stdout: '/home/me\nme\n', stderr: '', code: 0 })),
    spawnFn: vi.fn(() => ({
      kill: vi.fn(),
      // spawnWsl 形状的流：立即退出成功
    })),
    ...over,
  } as any
}

describe('findAction', () => {
  it('按 id 精确匹配', () => {
    expect(findAction([updateAll], 'update-all')?.label).toBe('全量更新')
    expect(findAction([updateAll], 'nope')).toBeNull()
  })
})

describe('actionRunner.prepare', () => {
  it('白名单外 id 拒绝', async () => {
    const runner = createActionRunner(makeDeps())
    await expect(runner.prepare('evil')).rejects.toMatchObject({
      code: 'TASK_FAILED',
      message: expect.stringContaining('动作不存在'),
    })
  })

  it('非法 id 拒绝（与 IPC 边界同一规则）', async () => {
    const runner = createActionRunner(makeDeps())
    await expect(runner.prepare('a\u0000b')).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    await expect(runner.prepare('a/b')).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
  })

  it('distro 动作未指定发行版 → 拒绝', async () => {
    const runner = createActionRunner(makeDeps())
    await expect(runner.prepare('update-all')).rejects.toMatchObject({
      code: 'DISTRO_NOT_FOUND',
    })
  })

  it('替换变量与 startupCwd，生成等价命令', async () => {
    const runner = createActionRunner(makeDeps())
    const p = await runner.prepare('open-code', 'Ubuntu')
    expect(p.distro).toBe('Ubuntu')
    expect(p.cwd).toBe('/home/me/proj')
    expect(p.rawCommand).toContain('--cd /home/me/proj')
    expect(p.rawCommand).not.toContain('${')
  })

  it('global 动作落到默认发行版并探测 ${user}', async () => {
    const deps = makeDeps()
    const runner = createActionRunner(deps)
    const p = await runner.prepare('whoami')
    expect(p.distro).toBe('Ubuntu')
    expect(p.args).toEqual(['me'])
    expect(deps.runWsl).toHaveBeenCalled()
  })

  it('无需探测时不调用 runWsl', async () => {
    const deps = makeDeps()
    const runner = createActionRunner(deps)
    await runner.prepare('update-all', 'Debian')
    expect(deps.runWsl).not.toHaveBeenCalled()
  })

  it('探测失败 → TASK_FAILED', async () => {
    const deps = makeDeps({
      runWsl: vi.fn(async () => ({ stdout: '', stderr: 'boom', code: 1 })),
    })
    const runner = createActionRunner(deps)
    await expect(runner.prepare('whoami')).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('没有发行版时 global 动作拒绝', async () => {
    const deps = makeDeps({
      wsl: { list: vi.fn(async () => []) },
    })
    const runner = createActionRunner(deps)
    await expect(runner.prepare('whoami')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
  })
})

describe('actionRunner.run', () => {
  it('headless 动作经 spawn 流式执行', async () => {
    const spawned: string[][] = []
    const spawnFn = vi.fn((args: string[], opts: any) => {
      spawned.push(args)
      queueMicrotask(() => opts.onExit(0))
      return { kill: vi.fn() }
    })
    const deps = makeDeps({ spawnFn })
    const runner = createActionRunner(deps)
    const prepared = await runner.prepare('update-all', 'Ubuntu')
    const ctl = makeCtl()
    await runner.run(prepared, ctl)
    expect(spawned[0]).toEqual([
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--cd',
      '/',
      '-e',
      '/usr/bin/bash',
      '-lc',
      'sudo apt update',
    ])
    expect(ctl.report).toHaveBeenCalledWith(100, '动作完成：全量更新')
    expect(ctl.log).toHaveBeenCalled()
  })

  it('headless 动作失败透传', async () => {
    const spawnFn = vi.fn((_args: string[], opts: any) => {
      queueMicrotask(() => opts.onExit(3))
      return { kill: vi.fn() }
    })
    const runner = createActionRunner(makeDeps({ spawnFn }))
    const prepared = await runner.prepare('update-all', 'Ubuntu')
    await expect(runner.run(prepared, makeCtl())).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('terminal 动作等待 PTY 退出', async () => {
    const deps = makeDeps()
    const runner = createActionRunner(deps)
    const prepared = await runner.prepare('open-code', 'Ubuntu')
    const info = runner.spawnTerminal(prepared)
    expect(info.ptyId).toBe('pty-1')
    expect(deps.pty.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({ distro: 'Ubuntu', program: '/usr/bin/code' }),
    )
    const ctl = makeCtl()
    await runner.run(prepared, ctl, info.ptyId)
    expect(deps.pty.waitExit).toHaveBeenCalledWith('pty-1')
    expect(ctl.report).toHaveBeenCalledWith(100, '动作完成：打开项目')
  })

  it('terminal 动作非零退出码 → TASK_FAILED', async () => {
    const deps = makeDeps({
      pty: {
        createCommand: vi.fn(() => ({ ptyId: 'p', distro: 'U', shell: 's', createdAt: 0 })),
        waitExit: vi.fn(async () => 2),
        kill: vi.fn(),
      },
    })
    const runner = createActionRunner(deps)
    const prepared = await runner.prepare('open-code', 'Ubuntu')
    await expect(runner.run(prepared, makeCtl(), 'p')).rejects.toMatchObject({
      code: 'TASK_FAILED',
    })
  })

  it('取消时 terminal 动作 kill 会话并报 TASK_CANCELED', async () => {
    const kill = vi.fn()
    let resolveExit: (code: number) => void = () => {}
    const deps = makeDeps({
      pty: {
        createCommand: vi.fn(() => ({ ptyId: 'p', distro: 'U', shell: 's', createdAt: 0 })),
        waitExit: vi.fn(
          () =>
            new Promise<number>((r) => {
              resolveExit = r
            }),
        ),
        kill: vi.fn((id: string) => {
          kill(id)
          resolveExit(137)
        }),
      },
    })
    const runner = createActionRunner(deps)
    const prepared = await runner.prepare('open-code', 'Ubuntu')
    const ctl = makeCtl({
      isCanceled: () => true,
      onCancel: (fn: () => void) => fn(), // 立即触发清理
    })
    const p = runner.run(prepared, ctl, 'p')
    await expect(p).rejects.toMatchObject({ code: 'TASK_CANCELED' })
    expect(kill).toHaveBeenCalledWith('p')
  })

  it('killSession 委托 pty.kill 且吞掉异常', () => {
    const deps = makeDeps({
      pty: {
        createCommand: vi.fn(),
        waitExit: vi.fn(),
        kill: vi.fn(() => {
          throw new Error('x')
        }),
      },
    })
    const runner = createActionRunner(deps)
    expect(() => runner.killSession('p')).not.toThrow()
    expect(deps.logger.warn).toHaveBeenCalled()
  })
})

describe('actionTaskHandle', () => {
  it('附带 / 不带 ptyId', () => {
    expect(actionTaskHandle('t')).toEqual({ taskId: 't' })
    expect(actionTaskHandle('t', { ptyId: 'p' })).toEqual({ taskId: 't', ptyId: 'p' })
    expect(actionTaskHandle('t', null)).toEqual({ taskId: 't' })
  })
})
