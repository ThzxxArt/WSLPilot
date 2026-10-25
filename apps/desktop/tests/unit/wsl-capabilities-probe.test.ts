import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wslpilot/kit', () => ({
  runWsl: vi.fn(),
  runWslc: vi.fn(),
}))

import { runWsl, runWslc } from '@wslpilot/kit'
import { probeWslCapabilities } from '../../src/main/services/wsl-capabilities'

const HELP = `
用法: wsl.exe
    --install [Distro] [Options...]
            --fixed-vhd
            --from-file <Path>
            --location <Location>
            --vhd-size <MemoryString>
            --web-download
    --manage <Distro> <Options...>
            --set-default-user <Username>
            --resize <MemoryString>
            --compact
            --set-sparse <true|false>
    --export <Distro> <FileName>
            --format <Format>
    --update
            --pre-release
`

describe('probeWslCapabilities（真实进程形态）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('3.0.3：--help 退出码 255 但 stderr 有完整帮助 → source=help 全能力', async () => {
    ;(runWsl as any).mockImplementation(async (args: string[]) => {
      if (args[0] === '--help') return { stdout: '', stderr: HELP, code: 255 }
      return { stdout: 'WSL 版本: 3.0.3.0', stderr: '', code: 0 }
    })
    ;(runWslc as any).mockResolvedValue({
      stdout: '{"Client":{"Version":"3.0.3.0"}}',
      stderr: '',
      code: 0,
    })
    const caps = await probeWslCapabilities()
    expect(caps?.source).toBe('help')
    expect(caps?.wslVersion).toBe('3.0.3.0')
    expect(caps?.wslcVersion).toBe('3.0.3.0')
    expect(runWslc).toHaveBeenCalledWith(['version', '--format', 'json'], { timeoutMs: 5_000 })
    expect(caps?.flags.compact).toBe(true)
    expect(caps?.flags.installLocation).toBe(true)
    expect(caps?.flags.updatePreRelease).toBe(true)
  })

  it('help 与 version 都不可用 → null（UI 必须按不支持处理）', async () => {
    ;(runWsl as any).mockResolvedValue({ stdout: '', stderr: '缺失', code: 1 })
    ;(runWslc as any).mockResolvedValue({ stdout: '', stderr: '', code: -1 })
    await expect(probeWslCapabilities()).resolves.toBeNull()
  })

  it('help 不可用但 version 可用 → 按 WSL_FEATURE_META 版本表兜底', async () => {
    ;(runWsl as any).mockImplementation(async (args: string[]) => {
      if (args[0] === '--help') return { stdout: '', stderr: 'no help', code: 1 }
      return { stdout: 'WSL version: 2.7.14.0', stderr: '', code: 0 }
    })
    ;(runWslc as any).mockResolvedValue({ stdout: '', stderr: '', code: -1 })
    const caps = await probeWslCapabilities()
    expect(caps?.source).toBe('version')
    expect(caps?.flags.resize).toBe(true)
    expect(caps?.flags.installLocation).toBe(true)
    expect(caps?.flags.vhdSize).toBe(true)
    expect(caps?.flags.updatePreRelease).toBe(true)
    // 2.9.8 才有的 compact 仍必须为 false
    expect(caps?.flags.compact).toBe(false)
  })
})
