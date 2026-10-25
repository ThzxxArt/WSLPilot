import { describe, it, expect } from 'vitest'
import {
  parseWslHelpFlags,
  parseWslVersionText,
  parseWslcVersionText,
  parseWindowsBuild,
  versionAtLeast,
} from '../../src/main/services/wsl-capabilities'

const HELP = `
用法: wsl.exe [Argument]
    --install [Distro] [Options...]
            --fixed-vhd
            --from-file <Path>
            --location <Location>
            --vhd-size <MemoryString>
            --web-download
            --no-launch, -n
    --manage <Distro> <Options...>
            --set-default-user <Username>
            --resize <MemoryString>
            --compact
            --set-sparse, -s <true|false>
    --export <Distro> <FileName> [选项]
            --format <Format>
    --update
            --pre-release
`

describe('WSL 能力探测纯函数（0.1.4）', () => {
  it('parseWslHelpFlags：逐 flag 探测，未出现的保持 false', () => {
    const flags = parseWslHelpFlags(HELP)
    expect(flags.compact).toBe(true)
    expect(flags.resize).toBe(true)
    expect(flags.setDefaultUser).toBe(true)
    expect(flags.installLocation).toBe(true)
    expect(flags.vhdSize).toBe(true)
    expect(flags.fixedVhd).toBe(true)
    expect(flags.webDownload).toBe(true)
    expect(flags.exportFormats).toBe(true)
    expect(flags.importFromFile).toBe(true)
    expect(flags.updatePreRelease).toBe(true)
    expect(flags.manageSparse).toBe(true)
    // 帮助里没有的 flag 不猜支持
    expect(parseWslHelpFlags('nothing here').compact).toBe(false)
  })

  it('版本 / wslc 版本 / Windows build 解析（中英文）', () => {
    expect(parseWslVersionText('WSL 版本: 3.0.3.0')).toBe('3.0.3.0')
    expect(parseWslVersionText('WSL version: 2.7.14.0')).toBe('2.7.14.0')
    expect(parseWslVersionText('no version')).toBe('')
    expect(parseWslcVersionText('wslc 3.0.3.0')).toBe('3.0.3.0')
    expect(parseWslcVersionText('{"version":"3.0.4.0"}')).toBe('3.0.4.0')
    expect(parseWindowsBuild('10.0.26300.9711')).toBe(26300)
    expect(parseWindowsBuild('bad')).toBe(0)
  })

  it('versionAtLeast：数字段比较，非法版本 false', () => {
    expect(versionAtLeast('3.0.3', '2.9.8')).toBe(true)
    expect(versionAtLeast('2.9.7', '2.9.8')).toBe(false)
    expect(versionAtLeast('2.10.0', '2.9.8')).toBe(true)
    expect(versionAtLeast('2.5.1', '2.5.1')).toBe(true)
    expect(versionAtLeast('', '2.0')).toBe(false)
    expect(versionAtLeast('x.y', '2.0')).toBe(false)
  })
})
