import { describe, it, expect } from 'vitest'
import {
  parseIniLines,
  getIniValue,
  setIniValue,
  removeIniKey,
  parseWslConf,
  collectUnknownKeys,
  applyWslConfModel,
  coerceWslConfValue,
  diffLines,
  isSameText,
  emptyWslConfModel,
  WSL_CONF_FIELDS,
} from './wslconf'

const SAMPLE = `# WSL 配置
[automount]
enabled = true
root = /mnt/
# 挂载选项
options = "metadata,umask=22,fmask=11"

[network]
generateHosts = false
hostname = mybox

[interop]
enabled = true
customKey = keep-me
`

describe('parseIniLines', () => {
  it('识别空行/注释/section/entry/未知行', () => {
    const lines = parseIniLines(SAMPLE)
    const types = lines.map((l) => l.type)
    expect(types).toContain('comment')
    expect(types).toContain('section')
    expect(types).toContain('entry')
    expect(types).toContain('blank')
    const sections = lines.filter((l) => l.type === 'section').map((l) => l.section)
    expect(sections).toEqual(['automount', 'network', 'interop'])
  })

  it('entry 解析 key = value，去引号', () => {
    const lines = parseIniLines(SAMPLE)
    const opt = lines.find((l) => l.key === 'options')
    expect(opt?.value).toBe('metadata,umask=22,fmask=11')
    expect(opt?.quoted).toBe(true)
    const root = lines.find((l) => l.key === 'root')
    expect(root?.value).toBe('/mnt/')
    expect(root?.quoted).toBe(false)
    expect(root?.section).toBe('automount')
  })

  it('空文本与无法识别的行', () => {
    expect(parseIniLines('')).toEqual([{ type: 'blank', raw: '' }])
    const lines = parseIniLines('???bad line')
    expect(lines[0]!.type).toBe('other')
  })
})

describe('getIniValue / setIniValue / removeIniKey', () => {
  it('getIniValue 读取已知键，缺失返回 undefined', () => {
    expect(getIniValue(SAMPLE, 'automount', 'enabled')).toBe('true')
    expect(getIniValue(SAMPLE, 'network', 'hostname')).toBe('mybox')
    expect(getIniValue(SAMPLE, 'network', 'nope')).toBeUndefined()
    expect(getIniValue(SAMPLE, 'nope', 'nope')).toBeUndefined()
  })

  it('setIniValue 修改已有键只动一行并保留注释', () => {
    const out = setIniValue(SAMPLE, 'automount', 'root', '/data/')
    expect(out).toContain('root = /data/')
    expect(out).toContain('# 挂载选项')
    expect(out).toContain('# WSL 配置')
    expect(out).not.toContain('root = /mnt/')
  })

  it('setIniValue 在已有 section 末尾插入新键', () => {
    const out = setIniValue(SAMPLE, 'network', 'generateResolvConf', true)
    expect(out).toContain('generateResolvConf = true')
    // 落在 [network] 与下一个 [interop] 之间
    const netIdx = out.indexOf('[network]')
    const interopIdx = out.indexOf('[interop]')
    const keyIdx = out.indexOf('generateResolvConf')
    expect(keyIdx).toBeGreaterThan(netIdx)
    expect(keyIdx).toBeLessThan(interopIdx)
  })

  it('setIniValue 追加不存在的 section', () => {
    const out = setIniValue(SAMPLE, 'boot', 'systemd', true)
    expect(out.trimEnd().endsWith('systemd = true')).toBe(true)
    expect(out).toContain('[boot]')
  })

  it('setIniValue 空文本直接建 section', () => {
    const out = setIniValue('', 'user', 'default', 'alice')
    expect(out).toContain('[user]')
    expect(out).toContain('default = alice')
  })

  it('setIniValue 对含空格的字符串加引号', () => {
    const out = setIniValue('', 'boot', 'command', 'service docker start')
    expect(out).toContain('command = "service docker start"')
  })

  it('removeIniKey 删除整行；键不存在原样返回', () => {
    const out = removeIniKey(SAMPLE, 'network', 'hostname')
    expect(out).not.toContain('hostname')
    expect(out).toContain('[network]')
    expect(removeIniKey(SAMPLE, 'network', 'zzz')).toBe(SAMPLE)
    expect(removeIniKey(SAMPLE, 'zzz', 'zzz')).toBe(SAMPLE)
  })
})

describe('wsl.conf 表单模型', () => {
  it('parseWslConf 解析已知字段', () => {
    const m = parseWslConf(SAMPLE)
    expect(m.automount.enabled).toBe(true)
    expect(m.automount.root).toBe('/mnt/')
    expect(m.automount.options).toBe('metadata,umask=22,fmask=11')
    expect(m.network.generateHosts).toBe(false)
    expect(m.network.hostname).toBe('mybox')
    expect(m.interop.enabled).toBe(true)
    expect(m.user.default).toBeUndefined()
    expect(m.boot.systemd).toBeUndefined()
  })

  it('coerceWslConfValue 处理布尔/数字/字符串/非法', () => {
    expect(coerceWslConfValue('boolean', 'true')).toBe(true)
    expect(coerceWslConfValue('boolean', 'NO')).toBe(false)
    expect(coerceWslConfValue('boolean', 'maybe')).toBeUndefined()
    expect(coerceWslConfValue('boolean', undefined)).toBeUndefined()
    expect(coerceWslConfValue('number', '10000')).toBe(10000)
    expect(coerceWslConfValue('number', 'x')).toBeUndefined()
    expect(coerceWslConfValue('string', ' hi ')).toBe('hi')
    expect(coerceWslConfValue('string', undefined)).toBeUndefined()
  })

  it('collectUnknownKeys 找出目录外的键', () => {
    const unknown = collectUnknownKeys(SAMPLE)
    expect(unknown).toEqual([{ section: 'interop', key: 'customKey', value: 'keep-me' }])
    expect(collectUnknownKeys('')).toEqual([])
  })

  it('applyWslConfModel 生成逐键变更并保留未知键/注释', () => {
    const model = emptyWslConfModel()
    model.network.hostname = 'newbox'
    model.interop.enabled = false
    const { text, changes } = applyWslConfModel(SAMPLE, model)
    expect(changes).toEqual(
      expect.arrayContaining([
        { section: 'network', key: 'hostname', before: 'mybox', after: 'newbox', kind: 'set' },
        { section: 'interop', key: 'enabled', before: 'true', after: 'false', kind: 'set' },
      ]),
    )
    expect(text).toContain('hostname = newbox')
    expect(text).toContain('customKey = keep-me')
    expect(text).toContain('# 挂载选项')
    expect(text).toContain('root = /mnt/')
  })

  it('applyWslConfModel：undefined 不触碰；空串/显式标记才删除', () => {
    // 未编辑的键（模型缺省）绝不动
    const model = emptyWslConfModel()
    model.network.hostname = 'mybox' // 相同 → 无变更
    const { text, changes } = applyWslConfModel(SAMPLE, model)
    expect(changes).toEqual([])
    expect(text).toBe(SAMPLE)

    // 字符串置空串 = 清除
    const m2 = parseWslConf(SAMPLE)
    m2.network.hostname = ''
    const r2 = applyWslConfModel(SAMPLE, m2)
    expect(r2.changes).toContainEqual({
      section: 'network',
      key: 'hostname',
      before: 'mybox',
      kind: 'remove',
    })
    expect(r2.text).not.toContain('hostname')

    // 显式 removeKeys 标记 = 清除（布尔等无「空值」语义的字段用）
    const m3 = parseWslConf(SAMPLE)
    const r3 = applyWslConfModel(SAMPLE, m3, { removeKeys: ['automount.mountFsTab'] })
    expect(r3.changes).toEqual([]) // 本来就没有 mountFsTab

    const base = '[user]\ndefault = bob\n'
    const r4 = applyWslConfModel(base, emptyWslConfModel(), { removeKeys: ['user.default'] })
    expect(r4.changes).toContainEqual({
      section: 'user',
      key: 'default',
      before: 'bob',
      kind: 'remove',
    })
    expect(r4.text).not.toContain('default = bob')
  })

  it('WSL_CONF_FIELDS 字段目录完整且带中文标签', () => {
    expect(WSL_CONF_FIELDS.length).toBeGreaterThanOrEqual(12)
    for (const f of WSL_CONF_FIELDS) {
      expect(f.label.length).toBeGreaterThan(0)
      expect(['automount', 'network', 'interop', 'user', 'boot']).toContain(f.section)
    }
  })
})

describe('diffLines / isSameText', () => {
  it('相同文本全部 same', () => {
    const d = diffLines('a\nb', 'a\nb')
    expect(d.every((x) => x.type === 'same')).toBe(true)
    expect(isSameText('a\nb', 'a\nb')).toBe(true)
    expect(isSameText('a', 'b')).toBe(false)
  })

  it('增删行带行号', () => {
    const d = diffLines('a\nb\nc', 'a\nx\nc')
    const del = d.find((x) => x.type === 'del')
    const add = d.find((x) => x.type === 'add')
    expect(del?.text).toBe('b')
    expect(del?.oldLine).toBe(2)
    expect(add?.text).toBe('x')
    expect(add?.newLine).toBe(2)
    expect(isSameText('a\nb\nc', 'a\nx\nc')).toBe(false)
  })

  it('纯新增 / 纯删除 / 空文本', () => {
    expect(diffLines('', 'a').map((d) => d.type)).toEqual(['add'])
    expect(diffLines('a', '').map((d) => d.type)).toEqual(['del'])
    expect(diffLines('', '').every((d) => d.type === 'same')).toBe(true)
    expect(isSameText('', '')).toBe(true)
  })
})
