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
    expect(out.text).toContain('Memory = 16GB')
    expect(out.text.match(/memory/gi)).toHaveLength(1)
    expect(collectUnknownWslConfigKeys(t)).toHaveLength(0)
  })

  it('未设置的字段保持 undefined（不伪造默认值）', () => {
    const model = parseWslConfigModel('')
    expect(model.wsl2.memory).toBeUndefined()
    expect(model.experimental.sparseVhd).toBeUndefined()
    expect(emptyWslConfigModel()).toEqual({ wsl2: {}, experimental: {} })
  })

  it('注释行与未知键不影响已知字段解析', () => {
    const model = parseWslConfigModel(SAMPLE)
    expect(model.wsl2.memory).toBe('8GB')
    const unknown = collectUnknownWslConfigKeys(SAMPLE)
    expect(unknown).toEqual([{ section: 'experimental', key: 'customKey', value: 'custom value' }])
  })
})

describe('validateWslConfigValue（表单校验）', () => {
  const field = (key: string) => WSL_CONFIG_FIELDS.find((f) => f.key === key)!

  it('size：数字 + MB/GB；空串 = 清除（合法）', () => {
    expect(SIZE_VALUE_RE.test('8GB')).toBe(true)
    expect(validateWslConfigValue(field('memory'), '8GB')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '4096MB')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '8')).toMatch(/MB\/GB/)
    expect(validateWslConfigValue(field('memory'), 'eight gb')).toMatch(/MB\/GB/)
    // swap=0 语义为禁用交换：允许字面 0（与字段提示一致）；memory 0 仍拒绝
    expect(validateWslConfigValue(field('swap'), '0')).toBeNull()
    expect(validateWslConfigValue(field('memory'), '0')).toBeTruthy()
  })

  it('number：1–256 整数；enum：白名单', () => {
    expect(validateWslConfigValue(field('processors'), '4')).toBeNull()
    expect(validateWslConfigValue(field('processors'), '0')).toBeTruthy()
    expect(validateWslConfigValue(field('processors'), '4.5')).toBeTruthy()
    expect(validateWslConfigValue(field('networkingMode'), 'mirrored')).toBeNull()
    expect(validateWslConfigValue(field('networkingMode'), 'bridge')).toBeTruthy()
    expect(validateWslConfigValue(field('autoMemoryReclaim'), 'dropcache')).toBeNull()
    expect(validateWslConfigValue(field('autoMemoryReclaim'), 'fast')).toBeTruthy()
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
