import { describe, it, expect } from 'vitest'
import {
  assertSafeBusId,
  buildUsbipdArgs,
  canAttach,
  canDetach,
  canToggleShare,
  normalizeUsbipdState,
  parseUsbipdList,
  previewUsbipdCommand,
  USBIPD_INSTALL_COMMAND,
  usbipdOpLabel,
  usbipdStateLabel,
} from './usbipd'

const LIST_OUTPUT = [
  'Connected:',
  'BUSID  VID:PID    DEVICE                                                        STATE',
  '1-2    046d:c534  USB Receiver                                                  Not attached',
  '1-4    0bda:0129  Realtek USB 2.0 Card Reader                                   Shared',
  '2-1    0951:1666  Kingston DataTraveler 3.0                                     Attached',
  '2-1.3  0781:5583  SanDisk Ultra Fit                                             Not shared',
  '',
  'Persisted:',
  'GUID                                  DEVICE',
].join('\r\n')

describe('assertSafeBusId', () => {
  it('接受标准 busid', () => {
    expect(assertSafeBusId('1-2')).toBe('1-2')
    expect(assertSafeBusId('2-1.3')).toBe('2-1.3')
    expect(assertSafeBusId('  1-4  ')).toBe('1-4')
  })

  it('拒绝非法形态', () => {
    expect(() => assertSafeBusId('')).toThrow(/BUSID 非法/)
    expect(() => assertSafeBusId('abc')).toThrow(/BUSID 非法/)
    expect(() => assertSafeBusId('1-2; rm -rf /')).toThrow(/BUSID 非法/)
    expect(() => assertSafeBusId('1-2/../x')).toThrow(/BUSID 非法/)
    expect(() => assertSafeBusId('x'.repeat(50))).toThrow(/BUSID 非法/)
    expect(() => assertSafeBusId(null)).toThrow(/BUSID 非法/)
  })
})

describe('parseUsbipdList', () => {
  it('解析设备行并保留状态', () => {
    const list = parseUsbipdList(LIST_OUTPUT)
    expect(list).toHaveLength(4)
    expect(list[0]).toEqual({
      busId: '1-2',
      vid: '046d',
      pid: 'c534',
      description: 'USB Receiver',
      state: 'not-attached',
    })
    expect(list[1]!.state).toBe('shared')
    expect(list[2]!.state).toBe('attached')
    expect(list[3]).toEqual({
      busId: '2-1.3',
      vid: '0781',
      pid: '5583',
      description: 'SanDisk Ultra Fit',
      state: 'not-shared',
    })
  })

  it('设备名中的多空格被压缩保留语义', () => {
    const raw =
      '1-2  046d:c534  USB   Receiver   Nano                                             Not attached'
    const list = parseUsbipdList(raw)
    expect(list).toHaveLength(1)
    expect(list[0]!.description).toBe('USB   Receiver   Nano')
  })

  it('空输出 / 表头 / 重复 busid', () => {
    expect(parseUsbipdList('')).toEqual([])
    expect(parseUsbipdList('Connected:\nBUSID  VID:PID  DEVICE  STATE')).toEqual([])
    const dup = ['1-2  046d:c534  Dev A  Not attached', '1-2  046d:c534  Dev B  Shared'].join('\n')
    expect(parseUsbipdList(dup)).toHaveLength(1)
    expect(parseUsbipdList(dup)[0]!.description).toBe('Dev A')
  })
})

describe('状态规范化与文案', () => {
  it('normalizeUsbipdState', () => {
    expect(normalizeUsbipdState('Not attached')).toBe('not-attached')
    expect(normalizeUsbipdState('Shared')).toBe('shared')
    expect(normalizeUsbipdState('Attached')).toBe('attached')
    expect(normalizeUsbipdState('Not shared')).toBe('not-shared')
    expect(normalizeUsbipdState('weird')).toBe('unknown')
    expect(normalizeUsbipdState('')).toBe('unknown')
  })

  it('usbipdStateLabel', () => {
    expect(usbipdStateLabel('not-attached')).toBe('未附加')
    expect(usbipdStateLabel('shared')).toBe('已共享')
    expect(usbipdStateLabel('attached')).toBe('已附加')
    expect(usbipdStateLabel('not-shared')).toBe('未共享')
    expect(usbipdStateLabel('unknown')).toBe('未知')
  })

  it('usbipdOpLabel', () => {
    expect(usbipdOpLabel('bind')).toBe('绑定')
    expect(usbipdOpLabel('unbind')).toBe('解除绑定')
    expect(usbipdOpLabel('attach')).toBe('附加到 WSL')
    expect(usbipdOpLabel('detach')).toBe('断开附加')
  })
})

describe('usbipd 命令构建', () => {
  it('bind / unbind / detach', () => {
    expect(buildUsbipdArgs('bind', '1-2')).toEqual(['bind', '--busid', '1-2'])
    expect(buildUsbipdArgs('unbind', '1-2')).toEqual(['unbind', '--busid', '1-2'])
    expect(buildUsbipdArgs('detach', '2-1.3')).toEqual(['detach', '--busid', '2-1.3'])
  })

  it('attach 带 --wsl 与可选发行版', () => {
    expect(buildUsbipdArgs('attach', '1-2')).toEqual(['attach', '--wsl', '--busid', '1-2'])
    expect(buildUsbipdArgs('attach', '1-2', 'Ubuntu-22.04')).toEqual([
      'attach',
      '--wsl',
      '--distribution',
      'Ubuntu-22.04',
      '--busid',
      '1-2',
    ])
  })

  it('参数注入被 busid 校验拦截', () => {
    expect(() => buildUsbipdArgs('attach', '1-2; evil')).toThrow(/BUSID 非法/)
  })

  it('等价命令行与执行参数同源', () => {
    expect(previewUsbipdCommand('bind', '1-2')).toBe('usbipd.exe bind --busid 1-2')
    expect(previewUsbipdCommand('attach', '1-2', 'Ubuntu')).toBe(
      'usbipd.exe attach --wsl --distribution Ubuntu --busid 1-2',
    )
  })

  it('安装命令唯一事实源', () => {
    expect(USBIPD_INSTALL_COMMAND).toContain('winget install usbipd')
  })
})

describe('能力开关', () => {
  it('canToggleShare', () => {
    expect(canToggleShare('not-attached')).toBe(true)
    expect(canToggleShare('shared')).toBe(true)
    expect(canToggleShare('not-shared')).toBe(true)
    expect(canToggleShare('attached')).toBe(false)
    expect(canToggleShare('unknown')).toBe(false)
  })

  it('canAttach / canDetach', () => {
    expect(canAttach('shared')).toBe(true)
    expect(canAttach('attached')).toBe(false)
    expect(canDetach('attached')).toBe(true)
    expect(canDetach('shared')).toBe(false)
  })
})
