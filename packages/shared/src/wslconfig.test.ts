import { describe, it, expect } from 'vitest'
import {
  applyWslConfigModel,
  collectUnknownWslConfigKeys,
  emptyWslConfigModel,
  parseWslConfigModel,
  summarizeWslConfigChanges,
  validateWslConfigValue,
  WSL_CONFIG_FIELDS,
  SIZE_VALUE_RE,
} from './wslconfig'
import { parseWslConfigMode } from './network'
import { getIniValue } from './wslconf'

const SAMPLE = `# 全局 WSL 配置
[wsl2]
memory=8GB
processors=4
networkingMode=mirrored

[experimental]
autoMemoryReclaim=gradual

# 用户自定义（表单未覆盖）
customKey=custom value
`

describe('parseWslConfigModel（.wslconfig 表单模型 — 0.1.3）', () => {
  it('解析已知字段：容量 / 数字 / 枚举 / 布尔（含大小写归一）', () => {
    const model = parseWslConfigModel(SAMPLE)
    expect(model.wsl2.memory).toBe('8GB')
    expect(model.wsl2.processors).toBe(4)
    expect(model.wsl2.networkingMode).toBe('mirrored')
    expect(model.experimental.autoMemoryReclaim).toBe('gradual')

    const bools = parseWslConfigModel('[wsl2]\ndnsTunneling=true\nfirewall=FALSE\n')
    expect(bools.wsl2.dnsTunneling).toBe(true)
    expect(bools.wsl2.firewall).toBe(false)
  })

  it('大小写不敏感：段/键名大小写不影响解析与最小编辑（不产生重复键）', () => {
    const t = '[WSL2]\nMemory=8GB\n'
    expect(parseWslConfigModel(t).wsl2.memory).toBe('8GB')
    const out = applyWslConfigModel(t, { ...emptyWslConfigModel(), wsl2: { memory: '16GB' } })
    expect(out.text).toContain('Memory=16GB')
    expect(out.text.match(/memory/gi)).toHaveLength(1)
    expect(collectUnknownWslConfigKeys(t)).toHaveLength(0)
  })

  it('未设置的字段保持 undefined（不伪造默认值）', () => {
    const model = parseWslConfigModel('')
    expect(model.wsl2.memory).toBeUndefined()
    expect(model.experimental.sparseVhd).toBeUndefined()
    expect(emptyWslConfigModel()).toEqual({ wsl2: {}, general: {}, experimental: {} })
  })

  it('注释行与未知键不影响已知字段解析', () => {
    const model = parseWslConfigModel(SAMPLE)
    expect(model.wsl2.memory).toBe('8GB')
    const unknown = collectUnknownWslConfigKeys(SAMPLE)
    expect(unknown).toEqual([{ section: 'experimental', key: 'customKey', value: 'custom value' }])
  })

  it('WP3 验收：general / none / consomme / dropCache 可读、可存、可往返', () => {
    const text =
      '[general]\ninstanceIdleTimeout=-1\ndistributionInstallPath=D:\\WSL\n' +
      '[wsl2]\nnetworkingMode=consomme\n' +
      '[experimental]\nautoMemoryReclaim=dropcache\n'
    const model = parseWslConfigModel(text)
    expect(model.general.instanceIdleTimeout).toBe(-1)
    expect(model.general.distributionInstallPath).toBe('D:\\WSL')
    expect(model.wsl2.networkingMode).toBe('consomme')
    expect(model.experimental.autoMemoryReclaim).toBe('dropCache')

    const { text: out, changes } = applyWslConfigModel(text, model)
    expect(getIniValue(out, 'general', 'instanceIdleTimeout')).toBe('-1')
    // 写侧必须按 WSL 转义反斜杠；读回是单反斜杠
    expect(getIniValue(out, 'general', 'distributionInstallPath')).toBe('D:\\WSL')
    expect(getIniValue(out, 'wsl2', 'networkingMode')).toBe('consomme')
    // 加载即 dirty 是缺陷：dropcache 语义等同 dropCache，未编辑不重写
    expect(getIniValue(out, 'experimental', 'autoMemoryReclaim')).toBe('dropcache')
    expect(changes).toEqual([])

    // 真正编辑时才写规范值（disabled → dropCache）
    const edited = parseWslConfigModel('[experimental]\nautoMemoryReclaim=disabled\n')
    edited.experimental.autoMemoryReclaim = 'dropCache'
    const toWrite = applyWslConfigModel('[experimental]\nautoMemoryReclaim=disabled\n', edited)
    expect(getIniValue(toWrite.text, 'experimental', 'autoMemoryReclaim')).toBe('dropCache')
    expect(toWrite.changes).toHaveLength(1)

    // none 也可读写；未知 enum 原样保留（不强行改写成推荐值）
    const none = applyWslConfigModel('[wsl2]\nnetworkingMode=none\n', {
      ...emptyWslConfigModel(),
      wsl2: { networkingMode: 'none' },
    }).text
    expect(getIniValue(none, 'wsl2', 'networkingMode')).toBe('none')
    const custom = applyWslConfigModel('[wsl2]\nnetworkingMode=bridge\n', {
      ...emptyWslConfigModel(),
      wsl2: { networkingMode: 'bridge' },
    })
    expect(custom.changes).toEqual([])
  })

  it('0.1.4 高价值键：kernel/defaultVhdSize/gpuSupport/bestEffortDnsParsing 可读可写', () => {
    const text =
      '[wsl2]\nkernel=C:\\Temp\\kernel\ndefaultVhdSize=1TB\ngpuSupport=true\n' +
      '[experimental]\nbestEffortDnsParsing=true\nhostAddressLoopback=true\nignoredPorts=3000,4000\n'
    const m = parseWslConfigModel(text)
    expect(m.wsl2.kernel).toBe('C:\\Temp\\kernel')
    expect(m.wsl2.defaultVhdSize).toBe('1TB')
    expect(m.wsl2.gpuSupport).toBe(true)
    expect(m.experimental.bestEffortDnsParsing).toBe(true)
    expect(m.experimental.hostAddressLoopback).toBe(true)
    expect(m.experimental.ignoredPorts).toBe('3000,4000')
    m.wsl2.gpuSupport = false
    m.experimental.bestEffortDnsParsing = false
    const out = applyWslConfigModel(text, m)
    expect(getIniValue(out.text, 'wsl2', 'gpuSupport')).toBe('false')
    expect(getIniValue(out.text, 'experimental', 'bestEffortDnsParsing')).toBe('false')
    // kernel 的 Windows 反斜杠写入必须被 WSL 转义后仍读回单反斜杠
    expect(getIniValue(out.text, 'wsl2', 'kernel')).toBe('C:\\Temp\\kernel')
  })
})

describe('validateWslConfigValue（表单校验）', () => {
  const field = (key: string) => WSL_CONFIG_FIELDS.find((f) => f.key === key)!

  it('size：WSL 语法（整数 + B/K/KB/M/MB/G/GB/T/TB）；空串 = 清除', () => {
    expect(SIZE_VALUE_RE.test('8GB')).toBe(true)
    expect(validateWslConfigValue(field('memory'), '8GB')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '4096MB')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '8G')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '8')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '1.5GB')).toMatch(/整数/)
    expect(validateWslConfigValue(field('memory'), '8gb')).toMatch(/整数/)
    expect(validateWslConfigValue(field('memory'), 'eight gb')).toMatch(/整数/)
    // swap=0 语义为禁用交换：允许字面 0；memory 0 仍拒绝
    expect(validateWslConfigValue(field('swap'), '0')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '0')).toBeTruthy()
  })

  it('number：范围校验；enum：白名单或显式 allowCustom', () => {
    expect(validateWslConfigValue(field('processors'), '4')).toBeNull()
    expect(validateWslConfigValue(field('processors'), '0')).toBeTruthy()
    expect(validateWslConfigValue(field('processors'), '4.5')).toBeTruthy()
    expect(validateWslConfigValue(field('networkingMode'), 'mirrored')).toBeNull()
    // WSL 对未知 networkingMode 有 NAT 回退；UI 允许保存并提示
    expect(validateWslConfigValue(field('networkingMode'), 'bridge')).toBeNull()
    expect(validateWslConfigValue(field('autoMemoryReclaim'), 'dropcache')).toBeNull()
    expect(validateWslConfigValue(field('autoMemoryReclaim'), 'fast')).toBeNull()
    // 非 allowCustom 的 enum 仍严格
    const strict = { ...field('networkingMode'), allowCustom: false }
    expect(validateWslConfigValue(strict, 'bridge')).toBeTruthy()
  })
})

describe('applyWslConfigModel（最小编辑，保留注释与未知键 — 0.1.3）', () => {
  it('修改已有键：只改目标行，注释与其余内容原样保留', () => {
    const model = parseWslConfigModel(SAMPLE)
    model.wsl2.memory = '16GB'
    const { text, changes } = applyWslConfigModel(SAMPLE, model)
    expect(text).toContain('# 全局 WSL 配置')
    expect(text).toContain('customKey=custom value')
    expect(getIniValue(text, 'wsl2', 'memory')).toBe('16GB')
    expect(getIniValue(text, 'wsl2', 'processors')).toBe('4')
    expect(changes).toEqual([
      { section: 'wsl2', key: 'memory', before: '8GB', after: '16GB', kind: 'set' },
    ])
  })

  it('新增键：插入到所属 section 内容末尾；section 不存在则文末追加', () => {
    const model = parseWslConfigModel(SAMPLE)
    model.experimental.sparseVhd = true
    const { text } = applyWslConfigModel(SAMPLE, model)
    expect(getIniValue(text, 'experimental', 'sparseVhd')).toBe('true')

    const empty = applyWslConfigModel('', model).text
    expect(empty).toContain('[experimental]')
    expect(getIniValue(empty, 'experimental', 'sparseVhd')).toBe('true')
  })

  it('清除键：字符串置空串删除整行；removeKeys 显式清除', () => {
    const model = parseWslConfigModel(SAMPLE)
    model.wsl2.memory = ''
    const { text, changes } = applyWslConfigModel(SAMPLE, model)
    expect(getIniValue(text, 'wsl2', 'memory')).toBeUndefined()
    expect(changes.some((c) => c.kind === 'remove' && c.key === 'memory')).toBe(true)

    const m2 = parseWslConfigModel(SAMPLE)
    const out2 = applyWslConfigModel(SAMPLE, m2, { removeKeys: ['wsl2.processors'] }).text
    expect(getIniValue(out2, 'wsl2', 'processors')).toBeUndefined()
  })

  it('布尔值渲染为 true/false 字面量；无变更时不产生 changes', () => {
    const model = parseWslConfigModel('[wsl2]\ndnsTunneling=false\n')
    model.wsl2.dnsTunneling = true
    const { text, changes } = applyWslConfigModel('[wsl2]\ndnsTunneling=false\n', model)
    expect(getIniValue(text, 'wsl2', 'dnsTunneling')).toBe('true')
    expect(changes).toHaveLength(1)

    const same = parseWslConfigModel(SAMPLE)
    expect(applyWslConfigModel(SAMPLE, same).changes).toEqual([])
  })
})

describe('summarizeWslConfigChanges', () => {
  it('无变更 / 修改与删除计数', () => {
    expect(summarizeWslConfigChanges([])).toBe('无变更')
    expect(
      summarizeWslConfigChanges([
        { section: 'wsl2', key: 'memory', after: '8GB', kind: 'set' },
        { section: 'wsl2', key: 'swap', before: '2GB', kind: 'remove' },
      ]),
    ).toBe('1 项修改 · 1 项删除')
  })
})

describe('network.parseWslConfigMode 与 wslconfig 解析同源（0.1.3 单一事实源）', () => {
  it('镜像模式读取对注释/大小写/引号的处理与编辑器一致', () => {
    expect(parseWslConfigMode('[wsl2]\nnetworkingMode=mirrored\n').mode).toBe('mirrored')
    expect(parseWslConfigMode('[wsl2]\nnetworkingMode = "NAT" # 注释\n').mode).toBe('nat')
    // 其他 section 中的同名键不得干扰
    expect(parseWslConfigMode('[experimental]\nnetworkingMode=mirrored\n').mode).toBe('unknown')
    expect(parseWslConfigMode('').mode).toBe('unknown')
  })
})
