import { describe, it, expect } from 'vitest'
import {
  assertSafeRuleId,
  buildPortProxyAddArgs,
  buildPortProxyDeleteArgs,
  buildPortProxyShowArgs,
  buildProxyScript,
  canApplyRule,
  defaultPortForwardRule,
  entryListened,
  isValidAddress,
  isValidIpv4,
  isValidIpv6,
  isValidPort,
  mirrorModeGuidance,
  mirrorModeSnippet,
  normalizeNetworkMode,
  normalizeProxyUrl,
  parsePortProxyShow,
  parseWslConfigMode,
  previewNetshCommand,
  PROXY_SCRIPT_PATH,
  proxySummary,
  resolveEffectiveProxy,
  ruleMatchesEntry,
  ruleSummary,
  shellQuote,
  validatePortForwardRule,
} from './network'
import type { PortForwardRule } from './types'

const RULE: PortForwardRule = {
  id: 'dev-3000',
  distro: 'Ubuntu-22.04',
  listenAddress: '0.0.0.0',
  listenPort: 3000,
  connectAddress: '127.0.0.1',
  connectPort: 3000,
  enabled: true,
  protocol: 'tcp',
}

describe('assertSafeRuleId', () => {
  it('接受常规 id', () => {
    expect(assertSafeRuleId('dev-3000')).toBe('dev-3000')
    expect(assertSafeRuleId('  dev 3000  ')).toBe('dev 3000')
    expect(assertSafeRuleId('转发-1')).toBe('转发-1')
  })

  it('拒绝空/超长/控制字符/非法字符', () => {
    expect(() => assertSafeRuleId('')).toThrow(/规则 id 非法/)
    expect(() => assertSafeRuleId('x'.repeat(101))).toThrow(/规则 id 非法/)
    expect(() => assertSafeRuleId('a\u0000b')).toThrow(/控制字符/)
    expect(() => assertSafeRuleId('a/b')).toThrow(/非法字符/)
    expect(() => assertSafeRuleId('a:b')).toThrow(/非法字符/)
    expect(() => assertSafeRuleId(123 as unknown as string)).toThrow(/规则 id 非法/)
  })
})

describe('netsh 参数与等价命令', () => {
  it('add 参数数组化', () => {
    expect(buildPortProxyAddArgs(RULE)).toEqual([
      'interface',
      'portproxy',
      'add',
      'v4tov4',
      'listenaddress=0.0.0.0',
      'listenport=3000',
      'connectaddress=127.0.0.1',
      'connectport=3000',
    ])
  })

  it('delete 只需监听键', () => {
    expect(buildPortProxyDeleteArgs(RULE)).toEqual([
      'interface',
      'portproxy',
      'delete',
      'v4tov4',
      'listenaddress=0.0.0.0',
      'listenport=3000',
    ])
  })

  it('show all 参数', () => {
    expect(buildPortProxyShowArgs()).toEqual(['interface', 'portproxy', 'show', 'all'])
  })

  it('等价命令行与执行参数同源', () => {
    expect(previewNetshCommand(RULE, 'add')).toBe(
      'netsh.exe interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=3000 connectaddress=127.0.0.1 connectport=3000',
    )
    expect(previewNetshCommand(RULE, 'delete')).toBe(
      'netsh.exe interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=3000',
    )
  })

  it('带空格的地址整体被引号包裹（参数数组语义不变）', () => {
    const cmd = previewNetshCommand({ ...RULE, listenAddress: 'host name' }, 'add')
    expect(cmd).toContain('"listenaddress=host name"')
  })
})

describe('parsePortProxyShow', () => {
  it('解析中文表头输出', () => {
    const raw = [
      '侦听 ipv4:                 连接到 ipv4:',
      '',
      '地址            端口        地址            端口',
      '--------------- ----------  --------------- ----------',
      '0.0.0.0         3000        127.0.0.1       3000',
      '192.168.1.5     8080        127.0.0.1       80',
      '',
    ].join('\r\n')
    expect(parsePortProxyShow(raw)).toEqual([
      {
        listenAddress: '0.0.0.0',
        listenPort: 3000,
        connectAddress: '127.0.0.1',
        connectPort: 3000,
        kind: 'v4tov4',
      },
      {
        listenAddress: '192.168.1.5',
        listenPort: 8080,
        connectAddress: '127.0.0.1',
        connectPort: 80,
        kind: 'v4tov4',
      },
    ])
  })

  it('英文表头与空输出都被安全跳过', () => {
    const raw = [
      'Listen on ipv4:             Connect to ipv4:',
      'Address            Port        Address            Port',
      '--------------- ----------  --------------- ----------',
      '0.0.0.0            3000        127.0.0.1          3000',
    ].join('\n')
    expect(parsePortProxyShow(raw)).toHaveLength(1)
    expect(parsePortProxyShow('')).toEqual([])
    expect(parsePortProxyShow(undefined as unknown as string)).toEqual([])
  })

  it('越界端口的行被丢弃', () => {
    expect(parsePortProxyShow('0.0.0.0 70000 127.0.0.1 1')).toEqual([])
    expect(parsePortProxyShow('0.0.0.0 0 127.0.0.1 1')).toEqual([])
  })
})

describe('规则与系统表对照', () => {
  const entry = {
    listenAddress: '0.0.0.0',
    listenPort: 3000,
    connectAddress: '127.0.0.1',
    connectPort: 3000,
    kind: 'v4tov4',
  }

  it('ruleMatchesEntry 全字段比对', () => {
    expect(ruleMatchesEntry(RULE, entry)).toBe(true)
    expect(ruleMatchesEntry({ ...RULE, connectPort: 3001 }, entry)).toBe(false)
  })

  it('entryListened 只看监听键', () => {
    expect(entryListened([entry], '0.0.0.0', 3000)).toBe(entry)
    expect(entryListened([entry], '0.0.0.0', 3001)).toBeNull()
  })
})

describe('镜像网络模式解析', () => {
  it('normalizeNetworkMode', () => {
    expect(normalizeNetworkMode('mirrored')).toBe('mirrored')
    expect(normalizeNetworkMode(' NAT ')).toBe('nat')
    expect(normalizeNetworkMode('Bridged')).toBe('bridged')
    expect(normalizeNetworkMode('virtioproxy')).toBe('virtioproxy')
    expect(normalizeNetworkMode('')).toBe('unknown')
    expect(normalizeNetworkMode('weird')).toBe('unknown')
  })

  it('读取 [wsl2] networkingMode', () => {
    const content = [
      '# 注释',
      '[wsl2]',
      'memory=4GB',
      'networkingMode=mirrored',
      '[experimental]',
      'x=1',
    ].join('\n')
    expect(parseWslConfigMode(content)).toEqual({ mode: 'mirrored', raw: 'mirrored' })
  })

  it('注释行与其它段落被忽略', () => {
    expect(parseWslConfigMode('[wsl2]\n# networkingMode=nat\nnetworkingMode=bridged').mode).toBe(
      'bridged',
    )
    expect(parseWslConfigMode('[wsl1]\nnetworkingMode=mirrored').mode).toBe('unknown')
    expect(parseWslConfigMode('').mode).toBe('unknown')
  })

  it('引导文案与配置片段', () => {
    expect(mirrorModeSnippet()).toContain('networkingMode=mirrored')
    const g = mirrorModeGuidance('nat')
    expect(g.title).toContain('镜像')
    expect(g.body).toContain('NAT')
    expect(mirrorModeGuidance('mirrored').body).toContain('mirrored')
  })
})

describe('代理助手', () => {
  it('normalizeProxyUrl 补全协议', () => {
    expect(normalizeProxyUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
    expect(normalizeProxyUrl('https://a.b:1')).toBe('https://a.b:1')
    expect(normalizeProxyUrl('  ')).toBe('')
  })

  it('resolveEffectiveProxy 本地值优先，系统代理兜底', () => {
    const base = {
      useWindowsProxy: true,
      httpProxy: '127.0.0.1:7890',
      httpsProxy: '',
      noProxy: 'localhost',
    }
    const eff = resolveEffectiveProxy(base, { enabled: true, server: 'proxy.corp:8080' })
    expect(eff.http).toBe('http://127.0.0.1:7890')
    expect(eff.https).toBe('http://proxy.corp:8080')
    expect(eff.noProxy).toBe('localhost')

    // 未启用系统代理 → 系统值不参与
    const off = resolveEffectiveProxy(
      { ...base, httpProxy: '', useWindowsProxy: false },
      { enabled: true, server: 'proxy.corp:8080' },
    )
    expect(off.http).toBe('')

    // 系统代理未启用 → 不兜底
    const disabled = resolveEffectiveProxy(base, { enabled: false, server: 'proxy.corp:8080' })
    expect(disabled.https).toBe('')
  })

  it('buildProxyScript 生成 export 行并防引号闭合', () => {
    const script = buildProxyScript({ http: "http://a'b:1", https: '', noProxy: 'localhost' })
    expect(script).toContain(`export http_proxy='http://a'\\''b:1'`)
    expect(script).toContain('export HTTP_PROXY=')
    expect(script).toContain('export no_proxy=')
    expect(script).not.toContain('https_proxy=')
    expect(script.endsWith('\n')).toBe(true)

    const empty = buildProxyScript({ http: '', https: '', noProxy: '' })
    expect(empty).toContain('当前未配置任何代理变量')
  })

  it('shellQuote', () => {
    expect(shellQuote('abc')).toBe("'abc'")
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })

  it('proxySummary', () => {
    expect(
      proxySummary({ useWindowsProxy: true, httpProxy: '', httpsProxy: '', noProxy: '' }),
    ).toBe('跟随系统')
    expect(
      proxySummary({
        useWindowsProxy: false,
        httpProxy: '127.0.0.1:1',
        httpsProxy: '',
        noProxy: '',
      }),
    ).toContain('HTTP')
    expect(
      proxySummary({ useWindowsProxy: false, httpProxy: '', httpsProxy: '', noProxy: '' }),
    ).toBe('未配置')
  })

  it('PROXY_SCRIPT_PATH 固定为 profile.d', () => {
    expect(PROXY_SCRIPT_PATH).toBe('/etc/profile.d/wslpilot-proxy.sh')
  })
})

describe('表单校验', () => {
  const form = {
    id: 'dev-3000',
    distro: 'Ubuntu',
    listenAddress: '0.0.0.0',
    listenPort: 3000,
    connectAddress: '127.0.0.1',
    connectPort: 3000,
    protocol: 'tcp' as const,
    enabled: true,
  }

  it('通过合法输入', () => {
    expect(validatePortForwardRule(form)).toBeNull()
  })

  it('逐项拒绝非法输入', () => {
    expect(validatePortForwardRule({ ...form, id: '' })).toMatch(/不能为空/)
    expect(validatePortForwardRule({ ...form, id: 'a/b' })).toMatch(/非法/)
    expect(validatePortForwardRule({ ...form, distro: ' ' })).toMatch(/发行版/)
    expect(validatePortForwardRule({ ...form, listenAddress: '' })).toMatch(/监听地址/)
    expect(validatePortForwardRule({ ...form, connectAddress: '999.1.1.1' })).toMatch(/转发地址/)
    expect(validatePortForwardRule({ ...form, listenPort: 0 })).toMatch(/监听端口/)
    expect(validatePortForwardRule({ ...form, connectPort: 70000 })).toMatch(/转发端口/)
    expect(validatePortForwardRule({ ...form, protocol: 'x' as 'tcp' })).toMatch(/协议/)
  })

  it('id 唯一性（编辑自身豁免）', () => {
    expect(validatePortForwardRule(form, ['dev-3000'])).toMatch(/已存在/)
    expect(validatePortForwardRule(form, ['dev-3000'], 'dev-3000')).toBeNull()
  })
})

describe('地址与端口合法性', () => {
  it('isValidPort', () => {
    expect(isValidPort(1)).toBe(true)
    expect(isValidPort(65535)).toBe(true)
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(1.5)).toBe(false)
  })

  it('isValidIpv4 / isValidIpv6', () => {
    expect(isValidIpv4('0.0.0.0')).toBe(true)
    expect(isValidIpv4('256.0.0.1')).toBe(false)
    expect(isValidIpv4('1.2.3')).toBe(false)
    expect(isValidIpv6('::1')).toBe(true)
    expect(isValidIpv6('fe80::1')).toBe(true)
    expect(isValidIpv6('abc')).toBe(false)
  })

  it('isValidAddress 允许主机名', () => {
    expect(isValidAddress('localhost')).toBe(true)
    expect(isValidAddress('my-host.local')).toBe(true)
    expect(isValidAddress('')).toBe(false)
    // 纯数字+点必须是合法 IPv4
    expect(isValidAddress('999.1.1.1')).toBe(false)
    expect(isValidAddress('1.2.3')).toBe(false)
    expect(isValidAddress('10.0.0.1')).toBe(true)
  })
})

describe('规则辅助', () => {
  it('defaultPortForwardRule', () => {
    const r = defaultPortForwardRule('Ubuntu')
    expect(r.distro).toBe('Ubuntu')
    expect(r.listenAddress).toBe('0.0.0.0')
    expect(r.protocol).toBe('tcp')
  })

  it('canApplyRule：udp 不可应用', () => {
    expect(canApplyRule(RULE)).toBe(true)
    expect(canApplyRule({ ...RULE, protocol: 'udp' })).toBe(false)
  })

  it('ruleSummary', () => {
    expect(ruleSummary(RULE)).toBe('0.0.0.0:3000 → 127.0.0.1:3000（Ubuntu-22.04 · TCP）')
  })
})
