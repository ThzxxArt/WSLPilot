import { describe, it, expect } from 'vitest'
import {
  parseIpcArgs,
  IPC_SCHEMAS,
  nameSchema,
  metricsNameSchema,
  configKeySchema,
  utf8Bytes,
} from '../src/ipc-schema'
import { CH, INVOKE_CHANNELS } from '../src/channels'

describe('ipc-schema', () => {
  it('parses distro name', () => {
    expect(parseIpcArgs(CH.distrosStart, ['Ubuntu'])).toBe('Ubuntu')
    expect(parseIpcArgs(CH.distrosStart, ['Ubuntu 22.04'])).toBe('Ubuntu 22.04')
  })

  it('rejects empty name', () => {
    expect(() => parseIpcArgs(CH.distrosStart, [''])).toThrow()
    expect(() => nameSchema.parse('')).toThrow()
    expect(() => nameSchema.parse('a/../b')).toThrow()
  })

  it('0.1.4 新通道：compact/resize/setDefaultUser 正反用例', () => {
    expect(parseIpcArgs(CH.distrosCompact, [{ name: 'Ubuntu', terminateFirst: true }])).toEqual({
      name: 'Ubuntu',
      terminateFirst: true,
    })
    expect(parseIpcArgs(CH.distrosCompact, [{ name: 'Ubuntu' }])).toEqual({
      name: 'Ubuntu',
      terminateFirst: false,
    })
    expect(() => parseIpcArgs(CH.distrosCompact, [{ terminateFirst: true }])).toThrow()
    expect(() =>
      parseIpcArgs(CH.distrosCompact, [{ name: 'Ubuntu', terminateFirst: 'yes' }]),
    ).toThrow()

    for (const size of ['50GB', '50G', '50', '1TB']) {
      expect(parseIpcArgs(CH.distrosResize, [{ name: 'Ubuntu', size }])).toEqual({
        name: 'Ubuntu',
        size,
      })
    }
    for (const size of ['1.5GB', '50gb', '50 GB', '']) {
      expect(() => parseIpcArgs(CH.distrosResize, [{ name: 'Ubuntu', size }])).toThrow()
    }

    expect(parseIpcArgs(CH.distrosSetDefaultUser, [{ name: 'Ubuntu', user: 'dev_user' }])).toEqual({
      name: 'Ubuntu',
      user: 'dev_user',
    })
    for (const user of ['a/b', 'a\\b', 'a\u0000b', '1abc']) {
      expect(() => parseIpcArgs(CH.distrosSetDefaultUser, [{ name: 'Ubuntu', user }])).toThrow()
    }
    expect(() => parseIpcArgs(CH.distrosSetDefaultUser, [{ user: 'dev' }])).toThrow()
  })

  it('parses configKey', () => {
    expect(parseIpcArgs(CH.configGet, ['settings'])).toBe('settings')
    expect(() => parseIpcArgs(CH.configGet, ['evil'])).toThrow()
    expect(() => configKeySchema.parse('nope')).toThrow()
  })

  it('parses configSet payload', () => {
    const out = parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: { general: {} } }])
    expect(out).toMatchObject({ fileKey: 'settings' })
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'bad', patch: {} }])).toThrow()
  })

  it('parses resolveConflict action', () => {
    expect(
      parseIpcArgs(CH.configResolveConflict, [{ fileKey: 'settings', action: 'reload' }]),
    ).toMatchObject({ action: 'reload' })
    expect(() =>
      parseIpcArgs(CH.configResolveConflict, [{ fileKey: 'settings', action: 'hack' }]),
    ).toThrow()
  })

  it('app:openExternal 拒绝控制字符与非法协议（review 0.1.2 二轮审计）', () => {
    expect(parseIpcArgs(CH.appOpenExternal, ['https://ok.dev'])).toBe('https://ok.dev')
    // 换行夹带的第二个 URL 不得通过（旧实现仅协议前缀白名单即可绕过）
    expect(() => parseIpcArgs(CH.appOpenExternal, ['https://x\nhttp://evil'])).toThrow()
    expect(() => parseIpcArgs(CH.appOpenExternal, ['javascript:alert(1)'])).toThrow()
    // 协议大小写变体经解析器规范化匹配白名单，不抛
    expect(() => parseIpcArgs(CH.appOpenExternal, ['HTTPS://OK.DEV'])).not.toThrow()
  })

  it('passes through channels without schema', () => {
    expect(parseIpcArgs(CH.distrosList, [])).toBeUndefined()
    expect(parseIpcArgs(CH.appGetVersion, [])).toBeUndefined()
  })

  it('metaSet validates payload', () => {
    expect(() => parseIpcArgs(CH.metaSet, [{ alias: 'x' }])).toThrow()
    expect(parseIpcArgs(CH.metaSet, [{ name: 'Ubuntu', alias: 'a' }])).toMatchObject({
      name: 'Ubuntu',
    })
  })

  it('validates pty create/input/resize/kill payloads', () => {
    expect(parseIpcArgs(CH.ptyCreate, [{ distro: 'Ubuntu', cols: 80, rows: 24 }])).toMatchObject({
      distro: 'Ubuntu',
      cols: 80,
    })
    expect(() => parseIpcArgs(CH.ptyCreate, [{ distro: '', cols: 80, rows: 24 }])).toThrow()
    expect(() => parseIpcArgs(CH.ptyInput, [{ ptyId: '', data: 'x' }])).toThrow()
    expect(parseIpcArgs(CH.ptyInput, [{ ptyId: 'p1', data: 'ls\n' }])).toMatchObject({
      ptyId: 'p1',
    })
    expect(() => parseIpcArgs(CH.ptyKill, [''])).toThrow()
    expect(parseIpcArgs(CH.ptyKill, ['p1'])).toBe('p1')
    expect(() => parseIpcArgs(CH.ptyResize, [{ ptyId: 'p1', cols: 1, rows: 10 }])).toThrow()
  })

  it('rejects prototype pollution keys in patch', () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true}}')
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: evil }])).toThrow()
    const evil2 = JSON.parse('{"a":{"constructor":{"x":1}}}')
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: evil2 }])).toThrow()
    // 正常 patch 可通过
    expect(() =>
      parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: { general: {} } }]),
    ).not.toThrow()
  })

  it('深度超限 fail-closed：深层 __proto__ 同样拒绝（review 0.1.2 纵深防御）', () => {
    const wrapDepth = (depth: number, leaf: unknown): Record<string, unknown> => {
      const root: Record<string, unknown> = {}
      let cur = root
      for (let i = 0; i < depth; i++) {
        const next: Record<string, unknown> = {}
        cur.n = next
        cur = next
      }
      cur.n = leaf
      return root
    }
    // 21 层包裹后的 __proto__：超出深度 20 无法证明干净 → 拒绝
    const deepEvil = wrapDepth(21, JSON.parse('{"__proto__":{"x":1}}'))
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: deepEvil }])).toThrow()
    // 浅层合法深嵌套不受影响
    const okDeep = wrapDepth(15, { value: 1 })
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: okDeep }])).not.toThrow()
  })

  it('every multi-arg IPC channel that is used in M1+M2 has a schema', () => {
    // 契约：注册了 handler 且带参的通道必须登记 schema，防止 M3 漏校验
    const required = [
      CH.distrosStart,
      CH.distrosTerminate,
      CH.distrosSetDefault,
      CH.registryDetail,
      CH.metaGet,
      CH.metaSet,
      CH.metricsSample,
      CH.configGet,
      CH.configSet,
      CH.configOpenExternal,
      CH.configResolveConflict,
    ]
    for (const ch of required) {
      expect(IPC_SCHEMAS[ch], `missing schema for ${ch}`).toBeTruthy()
    }
    // void 通道不应有 schema
    expect(IPC_SCHEMAS[CH.distrosList]).toBeUndefined()
    expect(IPC_SCHEMAS[CH.appGetVersion]).toBeUndefined()
  })
})

describe('ipc-schema · M4 备份迁移通道', () => {
  it('io:export validates name / path / format', () => {
    expect(
      parseIpcArgs(CH.ioExport, [{ name: 'Ubuntu', path: 'C:\\b\\u.tar', format: 'tar' }]),
    ).toEqual({
      name: 'Ubuntu',
      path: 'C:\\b\\u.tar',
      format: 'tar',
      terminateFirst: false,
    })
    expect(() => parseIpcArgs(CH.ioExport, [{ name: '', path: 'C:\\x', format: 'tar' }])).toThrow()
    expect(() => parseIpcArgs(CH.ioExport, [{ name: 'U', path: '', format: 'tar' }])).toThrow()
    expect(() =>
      parseIpcArgs(CH.ioExport, [{ name: 'U', path: 'a\u0000b', format: 'tar' }]),
    ).toThrow()
    expect(() => parseIpcArgs(CH.ioExport, [{ name: 'U', path: 'C:\\x', format: 'zip' }])).toThrow()
  })

  it('io:import validates payload and fills defaults', () => {
    const out = parseIpcArgs(CH.ioImport, [
      {
        name: 'New',
        installPath: 'D:\\N',
        archivePath: 'D:\\a.tar',
        format: 'tar',
      },
    ]) as { version: number; inPlace: boolean }
    expect(out.version).toBe(2)
    expect(out.inPlace).toBe(false)

    expect(() =>
      parseIpcArgs(CH.ioImport, [{ name: 'N', installPath: '', archivePath: '', format: 'tar' }]),
    ).toThrow()
    // 就地导入：installPath 允许为空
    expect(
      parseIpcArgs(CH.ioImport, [
        {
          name: 'N',
          installPath: '',
          archivePath: 'D:\\a.vhdx',
          format: 'vhd',
          inPlace: true,
        },
      ]),
    ).toMatchObject({ inPlace: true, installPath: '' })
    expect(() =>
      parseIpcArgs(CH.ioImport, [
        { name: 'N', installPath: 'D:\\N', archivePath: 'D:\\a.tar', format: 'tar', version: 3 },
      ]),
    ).toThrow()
    expect(() =>
      parseIpcArgs(CH.ioImport, [
        {
          name: 'N',
          installPath: 'D:\\N',
          archivePath: 'D:\\a.tar',
          format: 'tar',
          version: 1,
          inPlace: 'yes',
        },
      ]),
    ).toThrow()
  })

  it('io:move validates payload and defaults terminateFirst', () => {
    const out = parseIpcArgs(CH.ioMove, [{ name: 'U', path: 'D:\\U' }]) as {
      terminateFirst: boolean
    }
    expect(out.terminateFirst).toBe(false)
    expect(() => parseIpcArgs(CH.ioMove, [{ name: 'U', path: '' }])).toThrow()
    expect(() => parseIpcArgs(CH.ioMove, [{ name: '', path: 'D:\\U' }])).toThrow()
  })

  it('io:listBackups accepts empty / optional dir', () => {
    expect(parseIpcArgs(CH.ioListBackups, [{}])).toEqual({})
    expect(parseIpcArgs(CH.ioListBackups, [])).toEqual({})
    expect(parseIpcArgs(CH.ioListBackups, [{ dir: 'D:\\bk' }])).toEqual({ dir: 'D:\\bk' })
    expect(() => parseIpcArgs(CH.ioListBackups, [{ dir: '' }])).toThrow()
  })

  it('task:cancel validates taskId', () => {
    expect(parseIpcArgs(CH.taskCancel, ['t-1'])).toBe('t-1')
    expect(() => parseIpcArgs(CH.taskCancel, [''])).toThrow()
  })

  it('app pickers validate optional args', () => {
    expect(parseIpcArgs(CH.appPickDirectory, [])).toEqual({})
    expect(parseIpcArgs(CH.appPickDirectory, [{ defaultPath: 'D:\\x' }])).toEqual({
      defaultPath: 'D:\\x',
    })
    expect(() => parseIpcArgs(CH.appPickDirectory, [{ defaultPath: '' }])).toThrow()

    const save = parseIpcArgs(CH.appPickSaveFile, [
      { suggestedName: 'a.tar', filters: [{ name: 'TAR', extensions: ['tar'] }] },
    ]) as { suggestedName: string }
    expect(save.suggestedName).toBe('a.tar')
    expect(() =>
      parseIpcArgs(CH.appPickSaveFile, [{ filters: [{ name: 'x', extensions: [] }] }]),
    ).toThrow()
    expect(parseIpcArgs(CH.appPickOpenFile, [])).toEqual({})
    expect(() => parseIpcArgs(CH.appPickOpenFile, [{ defaultPath: 'a\u0001b' }])).toThrow()
    expect(parseIpcArgs(CH.appOpenPath, ['D:\\x'])).toBe('D:\\x')
    expect(() => parseIpcArgs(CH.appOpenPath, [''])).toThrow()
  })

  it('M4 invoke channels all carry schemas', () => {
    for (const ch of [
      CH.ioExport,
      CH.ioImport,
      CH.ioMove,
      CH.ioListBackups,
      CH.taskCancel,
      CH.appPickDirectory,
      CH.appPickSaveFile,
      CH.appPickOpenFile,
      CH.appOpenPath,
    ]) {
      expect(IPC_SCHEMAS[ch], `missing schema for ${ch}`).toBeTruthy()
    }
  })

  it('M5 wslconf / fs / action / setVersion 通过与拒绝用例（testing.md 兑现）', () => {
    // wslconf
    expect(parseIpcArgs(CH.wslconfRead, ['Ubuntu'])).toBe('Ubuntu')
    expect(() => parseIpcArgs(CH.wslconfRead, ['bad/name'])).toThrow()
    expect(parseIpcArgs(CH.wslconfWrite, [{ name: 'Ubuntu', content: '[boot]\n' }])).toEqual({
      name: 'Ubuntu',
      content: '[boot]\n',
    })
    // 超字节上限（中文场景）：65536 字符中文 ≈ 196KB，必须被字节 refine 拒绝
    expect(() =>
      parseIpcArgs(CH.wslconfWrite, [{ name: 'Ubuntu', content: '中'.repeat(40_000) }]),
    ).toThrow()
    expect(() => parseIpcArgs(CH.wslconfWrite, [{ name: 'Ubuntu', content: 'a\u0001b' }])).toThrow()

    // fs
    expect(parseIpcArgs(CH.fsReadDir, [{ distro: 'Ubuntu', path: '/etc' }])).toEqual({
      distro: 'Ubuntu',
      path: '/etc',
    })
    expect(() => parseIpcArgs(CH.fsRead, [{ distro: 'Ubuntu', path: 'a\u0000b' }])).toThrow()
    expect(parseIpcArgs(CH.fsWrite, [{ distro: 'U', path: '/x', data: 'y' }])).toBeTruthy()
    expect(() =>
      parseIpcArgs(CH.fsWrite, [{ distro: 'U', path: '/x', data: '中'.repeat(1_500_000) }]),
    ).toThrow()
    // 空路径 = 发行版根，合法（readDir/reveal 根目录是有效操作）
    expect(parseIpcArgs(CH.fsRevealInExplorer, [{ distro: 'U', path: '' }])).toEqual({
      distro: 'U',
      path: '',
    })
    expect(() => parseIpcArgs(CH.fsRevealInExplorer, [{ distro: 'U', path: 'a\u0001b' }])).toThrow()

    // action：id 与执行边界同一规则（控制字符 / 非法字符拒绝）
    expect(parseIpcArgs(CH.actionRun, [{ actionId: 'update-all', distro: 'Ubuntu' }])).toEqual({
      actionId: 'update-all',
      distro: 'Ubuntu',
    })
    expect(() => parseIpcArgs(CH.actionRun, [{ actionId: 'a/b' }])).toThrow()
    expect(() => parseIpcArgs(CH.actionRun, [{ actionId: 'a\u0001b' }])).toThrow()
    expect(() => parseIpcArgs(CH.actionRun, [{ actionId: '' }])).toThrow()

    // setVersion
    expect(parseIpcArgs(CH.distrosSetVersion, [{ name: 'Ubuntu', version: 1 }])).toEqual({
      name: 'Ubuntu',
      version: 1,
    })
    expect(() => parseIpcArgs(CH.distrosSetVersion, [{ name: 'Ubuntu', version: 3 }])).toThrow()
    expect(() => parseIpcArgs(CH.distrosSetVersion, [{ name: '', version: 2 }])).toThrow()

    // task:cancel
    expect(parseIpcArgs(CH.taskCancel, ['t1'])).toBe('t1')
    expect(() => parseIpcArgs(CH.taskCancel, [''])).toThrow()
  })

  it('utf8Bytes 与字符长度语义分离', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('中')).toBe(3)
    expect(utf8Bytes('')).toBe(0)
  })
})

describe('ipc-schema · M6 网络与设备通道', () => {
  it('network:apply / remove 只接受安全规则 id', () => {
    expect(parseIpcArgs(CH.networkApply, ['dev-3000'])).toBe('dev-3000')
    expect(() => parseIpcArgs(CH.networkApply, [''])).toThrow()
    expect(() => parseIpcArgs(CH.networkApply, ['a/b'])).toThrow()
    expect(() => parseIpcArgs(CH.networkApply, ['a\u0001b'])).toThrow()
    expect(() => parseIpcArgs(CH.networkApply, ['x'.repeat(101)])).toThrow()

    expect(parseIpcArgs(CH.networkRemove, ['dev-3000'])).toBe('dev-3000')
    expect(() => parseIpcArgs(CH.networkRemove, ['a:b'])).toThrow()
  })

  it('proxy 通道要求合法发行版名', () => {
    expect(parseIpcArgs(CH.networkProxyApply, [{ distro: 'Ubuntu' }])).toEqual({ distro: 'Ubuntu' })
    expect(parseIpcArgs(CH.networkProxyClear, [{ distro: 'Ubuntu' }])).toEqual({ distro: 'Ubuntu' })
    expect(parseIpcArgs(CH.networkProxyState, [{ distro: 'Ubuntu' }])).toEqual({ distro: 'Ubuntu' })
    expect(() => parseIpcArgs(CH.networkProxyApply, [{ distro: '' }])).toThrow()
    expect(() => parseIpcArgs(CH.networkProxyApply, [{}])).toThrow()
    expect(() => parseIpcArgs(CH.networkProxyState, [{ distro: 'a\u0000b' }])).toThrow()
  })

  it('devices 通道校验 BUSID 与可选发行版', () => {
    expect(parseIpcArgs(CH.devicesBind, ['1-2'])).toBe('1-2')
    expect(parseIpcArgs(CH.devicesUnbind, ['2-1.3'])).toBe('2-1.3')
    expect(parseIpcArgs(CH.devicesDetach, ['1-2'])).toBe('1-2')
    expect(() => parseIpcArgs(CH.devicesBind, ['evil; rm'])).toThrow()
    expect(() => parseIpcArgs(CH.devicesDetach, ['not-a-busid'])).toThrow()
    expect(() => parseIpcArgs(CH.devicesBind, [''])).toThrow()

    expect(parseIpcArgs(CH.devicesAttach, [{ busId: '1-2' }])).toEqual({ busId: '1-2' })
    expect(parseIpcArgs(CH.devicesAttach, [{ busId: '1-2', distro: 'Ubuntu' }])).toEqual({
      busId: '1-2',
      distro: 'Ubuntu',
    })
    expect(() => parseIpcArgs(CH.devicesAttach, [{ busId: 'x y' }])).toThrow()
    expect(() => parseIpcArgs(CH.devicesAttach, [{ busId: '1-2', distro: 'a/b' }])).toThrow()
  })

  it('M6 invoke 通道都已登记 schema 或属 void 清单', () => {
    const m6 = [
      CH.networkStatus,
      CH.networkApply,
      CH.networkApplyAll,
      CH.networkRemove,
      CH.networkProxyApply,
      CH.networkProxyClear,
      CH.networkProxyState,
      CH.devicesStatus,
      CH.devicesList,
      CH.devicesBind,
      CH.devicesUnbind,
      CH.devicesAttach,
      CH.devicesDetach,
    ]
    const voids = new Set<string>([
      CH.networkStatus,
      CH.networkApplyAll,
      CH.devicesStatus,
      CH.devicesList,
    ])
    for (const ch of m6) {
      if (voids.has(ch)) {
        expect(IPC_SCHEMAS[ch], `void 通道不应有 schema: ${ch}`).toBeUndefined()
      } else {
        expect(IPC_SCHEMAS[ch], `缺少 schema: ${ch}`).toBeTruthy()
      }
      expect(INVOKE_CHANNELS).toContain(ch)
    }
  })
})

describe('ipc-schema · 补漏通道（review 假信心根治 M2）', () => {
  it('distros:install 的 name 可选（省略 = 安装 WSL 本体）', () => {
    expect(() => parseIpcArgs(CH.distrosInstall, [{}])).not.toThrow()
    expect(() => parseIpcArgs(CH.distrosInstall, [{ name: 'Ubuntu' }])).not.toThrow()
    expect(() => parseIpcArgs(CH.distrosInstall, [{ name: '' }])).toThrow()
    expect(() => parseIpcArgs(CH.distrosInstall, [{ name: 'a/b' }])).toThrow()
    // 非 strict：多余键忽略，但必须 strip（只断言 not.toThrow 是形状盲假信心 — review 根治）
    expect(parseIpcArgs(CH.distrosInstall, [{ extra: 1, name: 'U' }])).toEqual({
      name: 'U',
      enableWsl1: false,
      fixedVhd: false,
      webDownload: false,
    })
    expect(() => parseIpcArgs(CH.distrosInstall, [{ extra: 1, name: 'U' }])).not.toThrow()
  })

  it('io:cleanupBackups 的 keep 越界拒绝、缺省 5', () => {
    const parsed = IPC_SCHEMAS[CH.ioCleanupBackups]!.parse({})
    expect((parsed as { keep: number }).keep).toBe(5)
    expect(() => parseIpcArgs(CH.ioCleanupBackups, [{ keep: 0 }])).toThrow()
    expect(() => parseIpcArgs(CH.ioCleanupBackups, [{ keep: 51 }])).toThrow()
    expect(() => parseIpcArgs(CH.ioCleanupBackups, [{ keep: 7, dir: 'D:\\b' }])).not.toThrow()
    expect(() => parseIpcArgs(CH.ioCleanupBackups, [{ keep: 7, dir: 'a\u0000b' }])).toThrow()
  })

  it('diagnostics:exportPackage 接受空参与可选目录，拒绝非法路径', () => {
    expect(() => parseIpcArgs(CH.diagnosticsExportPackage, [{}])).not.toThrow()
    expect(() => parseIpcArgs(CH.diagnosticsExportPackage, [])).not.toThrow()
    expect(() =>
      parseIpcArgs(CH.diagnosticsExportPackage, [{ defaultPath: 'C:\\logs' }]),
    ).not.toThrow()
    expect(() => parseIpcArgs(CH.diagnosticsExportPackage, [{ defaultPath: 'a\u0000b' }])).toThrow()
  })

  it('metrics:sample 只接受发行版名，拒绝全局概览键 `*`（概览走 metrics:overview）', () => {
    expect(parseIpcArgs(CH.metricsSample, ['Ubuntu'])).toBe('Ubuntu')
    expect(() => parseIpcArgs(CH.metricsSample, ['*'])).toThrow()
    expect(() => parseIpcArgs(CH.metricsSample, ['x/y'])).toThrow()
    expect(() => parseIpcArgs(CH.metricsSample, [''])).toThrow()
  })

  it('metrics:sample 的 schema 是 metricsNameSchema（禁 `*`），nameSchema 本身不变', () => {
    expect(IPC_SCHEMAS[CH.metricsSample]).toBe(metricsNameSchema)
    expect(IPC_SCHEMAS[CH.metricsSample]).not.toBe(nameSchema)
    // nameSchema 仍按 assertSafeDistroName 规则放行 `*`（合法发行版名字符，执行边界认可），
    // 只有 metrics:sample 通道显式拒绝全局保留键
    expect(nameSchema.parse('*')).toBe('*')
    expect(nameSchema.parse('Ubuntu')).toBe('Ubuntu')
    expect(metricsNameSchema.parse('Ubuntu')).toBe('Ubuntu')
    expect(() => metricsNameSchema.parse('*')).toThrow()
  })

  it('metrics:overview 无入参或空对象（OverviewMetrics 全局概览）', () => {
    expect(parseIpcArgs(CH.metricsOverview, [])).toBeUndefined()
    expect(parseIpcArgs(CH.metricsOverview, [{}])).toEqual({})
  })

  it('app:pickSaveFile 的 suggestedName 拒绝控制字符与超长', () => {
    expect(() => parseIpcArgs(CH.appPickSaveFile, [{ suggestedName: 'a\u0001b.tar' }])).toThrow()
    expect(() => parseIpcArgs(CH.appPickSaveFile, [{ suggestedName: 'a'.repeat(256) }])).toThrow()
    expect(() =>
      parseIpcArgs(CH.appPickSaveFile, [{ suggestedName: 'a'.repeat(255) }]),
    ).not.toThrow()
  })

  it('metaSet 的 tags/quickActions 条数与条目长度边界', () => {
    const base = { name: 'Ubuntu' }
    expect(() =>
      parseIpcArgs(CH.metaSet, [{ ...base, tags: Array.from({ length: 20 }, (_, i) => `t${i}`) }]),
    ).not.toThrow()
    expect(() =>
      parseIpcArgs(CH.metaSet, [{ ...base, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }]),
    ).toThrow()
    expect(() => parseIpcArgs(CH.metaSet, [{ ...base, tags: ['a'.repeat(65)] }])).toThrow()
    expect(() => parseIpcArgs(CH.metaSet, [{ ...base, tags: ['a'.repeat(64)] }])).not.toThrow()
    expect(() =>
      parseIpcArgs(CH.metaSet, [
        { ...base, quickActions: Array.from({ length: 21 }, (_, i) => `q${i}`) },
      ]),
    ).toThrow()
    expect(() => parseIpcArgs(CH.metaSet, [{ ...base, quickActions: ['a'.repeat(101)] }])).toThrow()
    expect(() =>
      parseIpcArgs(CH.metaSet, [{ ...base, quickActions: ['a'.repeat(100)] }]),
    ).not.toThrow()
  })

  it('configSet 的 patch 序列化后超 256KB 拒绝、循环引用拒绝', () => {
    const big = { general: { note: 'x'.repeat(256 * 1024) } }
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: big }])).toThrow()
    const ok = { general: { note: 'x'.repeat(1024) } }
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: ok }])).not.toThrow()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => parseIpcArgs(CH.configSet, [{ fileKey: 'settings', patch: cyclic }])).toThrow()
  })

  // ── 0.1.3：WSL 本体 / 磁盘 / 克隆 / 全局配置 / 剪贴板 ──

  it('distros:unregister 对象形态（backupFirst 默认 false）；字符串入参拒绝', () => {
    expect(parseIpcArgs(CH.distrosUnregister, [{ name: 'Ubuntu' }])).toEqual({
      name: 'Ubuntu',
      backupFirst: false,
    })
    expect(parseIpcArgs(CH.distrosUnregister, [{ name: 'Ubuntu', backupFirst: true }])).toEqual({
      name: 'Ubuntu',
      backupFirst: true,
    })
    expect(() => parseIpcArgs(CH.distrosUnregister, ['Ubuntu'])).toThrow()
    expect(() => parseIpcArgs(CH.distrosUnregister, [{ name: 'a/b' }])).toThrow()
  })

  it('distros:setSparse：发行版名 + 布尔；拒绝非法名与非布尔', () => {
    expect(parseIpcArgs(CH.distrosSetSparse, [{ name: 'Ubuntu', sparse: true }])).toEqual({
      name: 'Ubuntu',
      sparse: true,
    })
    expect(() => parseIpcArgs(CH.distrosSetSparse, [{ name: 'Ubuntu', sparse: 'yes' }])).toThrow()
    expect(() => parseIpcArgs(CH.distrosSetSparse, [{ name: '', sparse: true }])).toThrow()
  })

  it('io:clone：源/新名强校验 + 安装位置路径校验', () => {
    expect(
      parseIpcArgs(CH.ioClone, [
        { name: 'Ubuntu', newName: 'Ubuntu-Dev', installPath: 'D:\\WSL\\Ubuntu-Dev' },
      ]),
    ).toEqual({ name: 'Ubuntu', newName: 'Ubuntu-Dev', installPath: 'D:\\WSL\\Ubuntu-Dev' })
    expect(() =>
      parseIpcArgs(CH.ioClone, [{ name: 'Ubuntu', newName: 'a/b', installPath: 'D:\\x' }]),
    ).toThrow()
    expect(() =>
      parseIpcArgs(CH.ioClone, [{ name: 'Ubuntu', newName: 'U2', installPath: 'bad\u0000path' }]),
    ).toThrow()
  })

  it('wslconfig:write：字符 + 字节双上限；控制字符（除 \\t\\n\\r）拒绝', () => {
    expect(parseIpcArgs(CH.wslconfigWrite, [{ content: '[wsl2]\nmemory=8GB\n' }])).toEqual({
      content: '[wsl2]\nmemory=8GB\n',
    })
    expect(() => parseIpcArgs(CH.wslconfigWrite, [{ content: 'a\u0000b' }])).toThrow()
    expect(
      () => parseIpcArgs(CH.wslconfigWrite, [{ content: '中'.repeat(30000) }]), // 90KB UTF-8 > 64KB
    ).toThrow()
  })

  it('clipboard:write：允许换行文本，拒绝 NUL', () => {
    expect(parseIpcArgs(CH.clipboardWrite, ['ls -la\necho done\n'])).toBe('ls -la\necho done\n')
    expect(() => parseIpcArgs(CH.clipboardWrite, ['a\u0000b'])).toThrow()
  })

  it('app:wslUpdate 默认 preRelease=false；app:wslSetDefaultVersion 仅 1/2', () => {
    expect(parseIpcArgs(CH.appWslUpdate, [undefined])).toEqual({ preRelease: false })
    expect(parseIpcArgs(CH.appWslUpdate, [{ preRelease: true }])).toEqual({ preRelease: true })
    expect(() => parseIpcArgs(CH.appWslUpdate, [{ preRelease: 'x' }])).toThrow()
    expect(parseIpcArgs(CH.appWslSetDefaultVersion, [{ version: 2 }])).toEqual({ version: 2 })
    expect(() => parseIpcArgs(CH.appWslSetDefaultVersion, [{ version: 3 }])).toThrow()
  })
})
