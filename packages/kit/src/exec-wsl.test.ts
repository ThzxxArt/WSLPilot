import { describe, it, expect } from 'vitest'
import { parseDistroList, getRawCommand } from '../src/exec-wsl'

describe('parseDistroList', () => {
  it('parses English wsl -l -v output with default marker', () => {
    const raw = [
      '  NAME            STATE           VERSION',
      '* Ubuntu-22.04    Running         2',
      '  Debian          Stopped         2',
      '  Alpine          Stopped         1',
    ].join('\r\n')

    const list = parseDistroList(raw)
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({
      isDefault: true,
      name: 'Ubuntu-22.04',
      state: 'Running',
      version: 2,
    })
    expect(list[1]).toMatchObject({ isDefault: false, name: 'Debian', state: 'Stopped' })
    expect(list[2]).toMatchObject({ name: 'Alpine', version: 1 })
  })

  it('handles multi-space and Chinese names', () => {
    const raw = ['名称            状态           版本', '  测试发行版      正在运行       2'].join(
      '\r\n',
    )
    const list = parseDistroList(raw)
    expect(list[0]?.name).toBe('测试发行版')
    expect(list[0]?.state).toBe('正在运行')
  })

  it('skips blank lines', () => {
    const raw = 'NAME  STATE  VERSION\n* A  Running  2\n\n'
    expect(parseDistroList(raw)).toHaveLength(1)
  })
})

describe('getRawCommand', () => {
  it('quotes args with spaces', () => {
    expect(getRawCommand('wsl.exe', ['-d', 'Ubuntu 22.04', '-e', 'ls'])).toBe(
      'wsl.exe -d "Ubuntu 22.04" -e ls',
    )
  })
})
