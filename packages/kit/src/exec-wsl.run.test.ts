import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { runWsl, parseDistroList, getRawCommand, spawnWsl } from '../src/exec-wsl'

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>()
  return {
    ...actual,
    // execFile 被 promisify 后走 custom；mock 后用默认 promisify 会丢 stdout/stderr 对，
    // 因此显式提供与 Node execFile 等价的 promise 封装。
    promisify: (fn: any) => {
      if (fn === mockExecFile) {
        return (cmd: string, args: string[], opts: any) =>
          new Promise((resolve, reject) => {
            mockExecFile(cmd, args, opts, (err: any, stdout: any, stderr: any) => {
              if (err) {
                err.stdout = stdout
                err.stderr = stderr
                reject(err)
              } else {
                resolve({ stdout, stderr })
              }
            })
          })
      }
      return actual.promisify(fn)
    },
  }
})

describe('runWsl', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    mockSpawn.mockReset()
  })

  it('decodes UTF-16LE stdout and strips nulls', async () => {
    const text = 'NAME STATE VERSION'
    const buf = Buffer.from(text, 'utf16le')
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _o: unknown, cb: (e: any, o: Buffer, s: Buffer) => void) => {
        cb(null, buf, Buffer.alloc(0))
      },
    )

    const r = await runWsl(['--list', '--verbose'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(text)
    expect(r.stderr).toBe('')
    expect(mockExecFile.mock.calls[0][1]).toEqual(['--list', '--verbose'])
  })

  it('returns code from failure and decodes stderr', async () => {
    const err: any = new Error('fail')
    err.code = 42
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(err, Buffer.from('out', 'utf16le'), Buffer.from('bad thing', 'utf16le'))
    })

    const r = await runWsl(['x'])
    expect(r.code).toBe(42)
    expect(r.stderr).toBe('bad thing')
    expect(r.stdout).toBe('out')
  })

  it('supports utf8 encoding option', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(null, Buffer.from('plain utf8', 'utf8'), Buffer.alloc(0))
    })
    const r = await runWsl(['x'], { encoding: 'utf8' })
    expect(r.stdout).toBe('plain utf8')
  })

  it('handles missing stdout buffer as empty string', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(null, undefined, undefined)
    })
    const r = await runWsl(['x'])
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })

  it('maps non-numeric code to -1', async () => {
    const err: any = new Error('x')
    err.code = 'ENOENT'
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(err, Buffer.alloc(0), Buffer.alloc(0))
    })
    const r = await runWsl(['x'])
    expect(r.code).toBe(-1)
  })
})

describe('parseDistroList', () => {
  it('parses English output with default marker', () => {
    const raw = [
      'NAME            STATE           VERSION',
      '* Ubuntu-22.04    Running         2',
      '  Debian          Stopped         2',
    ].join('\r\n')
    const list = parseDistroList(raw)
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({
      isDefault: true,
      name: 'Ubuntu-22.04',
      state: 'Running',
      version: 2,
    })
  })

  it('handles Chinese names and multi-space', () => {
    const raw = '名称            状态           版本\n  测试发行版      正在运行       2'
    const list = parseDistroList(raw)
    expect(list[0]?.name).toBe('测试发行版')
  })

  it('defaults version to 2 when missing', () => {
    const list = parseDistroList('NAME STATE VERSION\n  A  Running')
    expect(list[0]?.version).toBe(2)
  })
})

describe('getRawCommand', () => {
  it('quotes args with spaces', () => {
    expect(getRawCommand('wsl.exe', ['-d', 'Ubuntu 22.04'])).toBe('wsl.exe -d "Ubuntu 22.04"')
  })
  it('leaves simple args bare', () => {
    expect(getRawCommand('wsl.exe', ['-e', 'ls'])).toBe('wsl.exe -e ls')
  })
})

describe('spawnWsl', () => {
  beforeEach(() => {
    mockSpawn.mockReset()
  })

  it('streams UTF-16LE lines separately per stream and reports exit', () => {
    const fake: any = new EventEmitter()
    fake.stdout = new EventEmitter()
    fake.stderr = new EventEmitter()
    fake.kill = vi.fn()
    mockSpawn.mockReturnValue(fake)

    const lines: string[] = []
    const exits: number[] = []
    const handle = spawnWsl(['--list'], {
      onLine: (l) => lines.push(l),
      onExit: (c) => exits.push(c),
      onError: () => {},
    })

    fake.stdout.emit('data', Buffer.from('line1\nline2\npartial', 'utf16le'))
    fake.stderr.emit('data', Buffer.from('errline\n', 'utf16le'))
    fake.emit('close', 0)

    expect(lines).toContain('line1')
    expect(lines).toContain('line2')
    expect(lines).toContain('errline')
    expect(lines.join('|')).not.toContain('partialerrline')
    expect(exits).toEqual([0])

    handle.kill()
    expect(fake.kill).toHaveBeenCalled()
  })

  it('propagates spawn error and defaults exit code', () => {
    const fake: any = new EventEmitter()
    fake.stdout = new EventEmitter()
    fake.stderr = new EventEmitter()
    fake.kill = vi.fn()
    mockSpawn.mockReturnValue(fake)

    const errors: Error[] = []
    const exits: number[] = []
    spawnWsl([], {
      onLine: () => {},
      onExit: (c) => exits.push(c),
      onError: (e) => errors.push(e),
    })

    fake.emit('error', new Error('spawn fail'))
    fake.emit('close', null as any)

    expect(errors[0].message).toBe('spawn fail')
    expect(exits).toEqual([-1])
  })
})
